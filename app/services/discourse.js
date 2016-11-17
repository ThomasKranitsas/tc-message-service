'use strict'
var Promise = require('bluebird');
var config = require('config');
var axios = require('axios');
var _ = require('lodash');


const DISCOURSE_SYSTEM_USERNAME = config.get('discourseSystemUsername')
/**
 * Service to facilitate communication with the discourse api
 */
var Discourse = () => {

    /**
     * Discourse client configuration
     */
    var client = axios.create({ baseURL: config.get('discourseURL')})
    client.defaults.params = {
      api_key: config.get('discourseApiKey'),
      api_username: DISCOURSE_SYSTEM_USERNAME
    }
    /**
     * Uncomment to debug discourse api calls
     */
    // client.interceptors.response.use((resp) => {
    //   console.log('SUCCESS', resp.config.url)
    //   return resp
    // }, (err) => {
    //   console.log(err),
    //   Promise.reject(err)
    // })

   /**
    * Fetches a Discourse user by username
    * username: the Discourse user name
    */
   this.getUser = (username) => {
        return client.get(`/users/${username}.json?api_username=${username}`)
        .then((response) => response.data);
    }

    /**
     * Creates a new user in Discourse
     * name: first and last name of the user
     * username: username, must be unique
     * email: email of the user, must be unique
     * password: password of the user, this will be ignored since we will be using SSO
     */
    this.createUser = (logger, name, username, email, password) => {
        logger.debug('Creating user in discourse:', username)
        return client.post('/users', {
            name: name,
            username: username,
            email: email,
            password: password,
            active: true
        });
    }

    /**
     * Creates a private post in discourse
     * title: the title of the post
     * post: the body of the post, html markup is allowed
     * users: comma separated list of user names that should be part of the conversation
     */
    this.createPrivatePost = (title, post, users, owner) => {
        return client.post('/posts', {}, {
          params: {
            archetype: 'private_message',
            target_usernames: users,
            api_username: owner ? owner : DISCOURSE_SYSTEM_USERNAME,
            title: title,
            raw: post
          }
        })
    }

    /**
     * Gets a topic in Discourse
     * topicId: the id of the topic
     * username: the username to use to fetch the topic, for security purposes
     */
    this.getTopic = (topicId, username) => {
        return client.get(`/t/${topicId}.json?api_username=${username}`)
        .then((response) => response.data);
    }

    /**
     * Grants access to a user by adding that user to the Discrouse topic (or private post)
     * userName: identifies the user that should receive access
     * topicId: identifier of the topic to which access should be granted
     */
    this.grantAccess = (userName, topicId) => {
        return client.post(`/t/${topicId}/invite`, {
            user: userName
        });
    }

    /**
     * Creates a post (reply) to a topic
     * username: user creating the post
     * post: body of the post, html markup is permitted
     * discourseTopicId: the topic id to which the response is being posted
     */
    this.createPost = (username, post, discourseTopicId, responseTo) => {
        var data = 'topic_id=' + discourseTopicId + '&raw=' + encodeURIComponent(post);
        if(responseTo) {
          data += '&reply_to_post_number=' + responseTo;
        }

        return client.post(`/posts?api_username=${username}`, data);
    }

    /**
     * Fetches posts from discourse
     * username: the name of the user to use to access the Discourse API
     * topicId: the id of the topic that is parent to the posts
     * postIds: array containing the list of posts that should be retrieved
     */
     this.getPosts = (username, topicId, postIds) => {

        var postIdsFilter = '';
        var separator = '';
        _(postIds).each(postId => {
            postIdsFilter += `${separator}${encodeURIComponent('post_ids[]')}=${postId}`;
            separator = '&';
        });

        return client.get(`/t/${topicId}/posts.json?${postIdsFilter}`);
     }


    /**
     * Marks a topic and posts are read in discourse
     * username: the name of the user who read the topic
     * topicId: the id of the topic the user read
     * postIds: array of post ids representing the posts the user read
     */
    this.markTopicPostsRead = (username, topicId, postIds) => {
        var parts = ['topic_id=' + topicId, 'topic_time=' + topicId];
        postIds.forEach(postId => {
            parts.push(encodeURIComponent('timings[' + postId + ']') + '=1000');
        });
        return client.post(`/topics/timings.json?api_username=${username}`, parts.join('&'));
    }

    return this;
}

module.exports = Discourse;
