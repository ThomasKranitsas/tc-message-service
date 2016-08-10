'use strict'

var _ = require('lodash');
var config = require('config');
var util = require('tc-core-library-js').util(config);
var Promise = require('bluebird');
var Discourse = require('../../services/discourse');
var axios = require('axios');

/**
 * Handles listing of topics
 * logger: the logger
 * db: sequelize db with all models loaded
 */
module.exports = (logger, db) => {
    var discourseClient = Discourse(logger);

    /**
     * Checks if a topic lookup exists, if it does it means there is security
     * enabled for this given entity, and we should check if the user has access
     * to the entity before allowing access to the topics
     * filter: {'reference': referenceName }
     */
    function topicLookupExists(filter) {
        return db.topics.findAll({
            where: filter
        }).then((result) => {
            return result;
        });
    }

    /**
     * Fetches a topcoder user from the topcoder members api
     * authToken: The user's authentication token, will be used to call the member service api
     * handle: handle of the user to fetch
     */
    function getTopcoderUser(authToken, handle) {
        return new Promise((resolve, reject) => {
            axios.get(config.memberServiceUrl + '/' + handle, {
                headers: {
                    'Authorization': authToken,
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            }).then((response) => {
                resolve(response.data.result.content);
            }).catch((error) => {
                reject(error);
            });
       });
    }

    /**
     * Verifies if a user has access to a certain topcoder entity such as a project,
     * challenge, or submission, by making a call to the api configured in the referenceLookup table
     * authToken: user's auth token to use to call the api
     * reference: name of the reference, used to find the endpoint in the referenceLookupTable
     * referenceId: identifier of the reference record
     */
    function userHasAccessToEntity(authToken, reference, referenceId) {
        return new Promise((resolve, reject)  => {
            db.referenceLookups.findOne({
                where: {
                    reference: reference
                }
            }).then((result) => {
                if(!result) {
                    resolve(true);
                } else {
                    var referenceLookup = result;
                    axios.get(referenceLookup.endpoint.replace('{id}', referenceId), {
                        headers: {
                            'X-Request-Id': '123',
                            'Authorization': 'Bearer ' + authToken,
                            'Accept': 'application/json',
                            'Content-Type': 'application/json'
                        },
                        timeout: 3000
                    }).then((response) => {
                        if(response.data && response.data.result
                            && response.data.result.status == 200 && response.data.result.content) {
                            resolve(true);
                        } else {
                            resolve(false);
                        }
                    }).catch((error) => {
                        resolve(false);
                    });
                 }
            });
        });
    }

    /**
     * Checks if a user has access to an entity, and if they do, provision a user in Discourse if one doesn't exist
     * req: the express request
     * filter: {'reference': reference, 'referenceId': referenceId}
     */
    function checkAccessAndProvision(req, filter) {
        return userHasAccessToEntity(req.header.authorization, filter.reference, filter.referenceId).then((hasAccess) => {
            logger.info('hasAccess: '+hasAccess);
            if(!hasAccess) {
                return Promise.reject('User doesn\'t have access to entity');
            } else {
                logger.info('User has access to entity');
                // Does the discourse user exist
                return discourseClient.getUser(req.authUser.handle).then((user) => {
                    logger.info('Successfully got the user from Discourse');
                    return user;
                }).catch((error) => {
                    logger.info('Discourse user doesn\'t exist, creating one');
                    // User doesn't exist, create
                    // Fetch user info from member service
                    return getTopcoderUser(req.headers.authorization, req.authUser.handle).then((user) => {
                        logger.info('Successfully got topcoder user');
                        logger.info(user);

                        // Create discourse user
                        return discourseClient.createUser(user.firstName + ' ' + user.lastName,
                                user.handle,
                                user.email,
                                config.defaultDiscoursePw).then((result) =>{
                            if(result.data.success) {
                                logger.info('Discourse user created');
                                return result.data;
                            } else {
                                logger.error("Unable to create discourse user");
                                logger.error(result);
                                return Promise.reject(result);
                            }
                        }).catch((error) => {
                            logger.error('Failed to create discourse user');
                            return Promise.reject(error);
                        });
                    }).catch((error) => {
                        return Promise.reject(error);
                    });
                });
            }
        });
    }

    /**
     * Gets a topic from Discourse, and in the process it does:
     *  - Checks if the user has access to the referred entity
     *  - Checks if a user exists in Discourse, if not, it creates one
     *  - Checks if a topic associated with this entity exists in Discourse, if not creates one
     *  - If the topic already exists, checks if the user has access, if not gives access
     * params: standard express parameters
     */
    return (req, resp) => {
        // Parse filter
        var parsedFilter = (req.query.filter || '').split('&');
        var filter = {};

        _(parsedFilter).each(value => {
            let split = value.split('=');

            if(split.length == 2) {
                filter[split[0]] = split[1];
            }
        });
        // Verify required filters are present
        if(!filter.reference || !filter.referenceId) {
            resp.status(400).send({
                message: 'Please provide reference and referenceId filter parameters'
            });

            return;
        }

        var pgTopic;

        // Check if the topic exists in the pg database
        topicLookupExists(filter).then((result) => {
            if(result.length === 0) {
                logger.info('topic doesn\'t exist');
                return checkAccessAndProvision(req, filter).then(() => {
                    return discourseClient.createPrivatePost(
                        'Discussion for ' + filter.reference + ' ' + filter.referenceId,
                        'Discussion for ' + filter.reference + ' ' + filter.referenceId,
                        req.authUser.handle).then((response) => {
                        if(response.status == 200) {
                            pgTopic = db.topics.build({
                                reference: filter.reference,
                                referenceId: filter.referenceId,
                                discourseTopicId: response.data.topic_id,
                                createdAt: new Date(),
                                createdBy: req.authUser.handle,
                                updatedAt: new Date(),
                                updatedBy: req.authUser.handle
                            });

                            return pgTopic.save().then((result) => {
                                logger.info('topic created in pg');
                                return response;
                            }).catch((error) => {
                                logger.error(error);
                                return Promise.reject(error);
                            });
                        } else {
                            return Promise.reject(response);
                        }
                    });
                }).catch((error) => {
                    return Promise.reject(error);
                });
            } else {
                logger.info('Topic exists in pg, fetching from discourse');
                pgTopic = result[0];
                return discourseClient.getTopic(pgTopic.discourseTopicId, req.authUser.handle).then((response) => {
                    logger.info('Topic received from discourse');
                    return response;
                }).catch((error) => {
                    logger.info('Failed to get topic from discourse');

                    // If 403, it is possible that the user simply hasn't been granted access to the topic yet
                    if(error.response.status == 403) {
                        logger.info('User doesn\'t have access to topic, checking access and provisioning');

                        // Verify if the user has access and if so provision
                        return checkAccessAndProvision(req, filter).then((discourseUser) => {
                            // Grand access to the topic to the user
                            logger.info('User entity access verified, granting access to topic');
                            return discourseClient.grantAccess(req.authUser.handle, pgTopic.discourseTopicId).then(() => {
                                logger.info('Succeed to grant access to topic');
                                return discourseClient.getTopic(pgTopic.discourseTopicId, req.authUser.handle).then((response) => {
                                    logger.info('Topic received from discourse');
                                    return response;
                                });
                            });
                        });
                    } else {
                        logger.error(error);
                        return Promise.reject(error);
                    }
                });
            }
        }).then((topic) => {
            // Retrive the topic from Discourse
            logger.info('returning topic');
            return resp.status(200).send(topic.data);
        }).catch((error) => {
            logger.error(error);
            resp.status(500).send({
                message: 'Error fetching topic!'
            });
        });
    }
}