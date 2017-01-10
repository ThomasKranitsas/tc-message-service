'use strict'
var Promise = require('bluebird');
var config = require('config');
var axios = require('axios');
var _ = require('lodash');
var util = require('../util');


const DISCOURSE_SYSTEM_USERNAME = config.get('discourseSystemUsername')
  /**
   * Service to facilitate communication with the discourse api
   */
var Discourse = (logger) => {

  /**
   * Discourse client configuration
   */
  var client = axios.create({
    baseURL: config.get('discourseURL')
  })
  client.defaults.params = {
    api_key: config.get('discourseApiKey'),
    api_username: DISCOURSE_SYSTEM_USERNAME
  }

  client.interceptors.response.use((resp) => {
    logger.debug('SUCCESS', resp.request.path)
    return resp
  }, (err) => {
    logger.error('Discourse call failed: ', _.pick(err.response, ['config', 'data']))
    return Promise.reject(err)
  })

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
  this.createUser = (name, userId, handle, email, password, photoUrl) => {
    logger.debug('Creating user in discourse:', name, userId, handle)
    // TODO: add photo URL
    return client.post('/users', {
      name: name,
      username: userId,
      email: email,
      password: password,
      active: true,
      user_fields: { "1": handle }
    })
  }

  /**
   * Creates a private post in discourse
   * title: the title of the post
   * post: the body of the post, html markup is allowed
   * users: comma separated list of user names that should be part of the conversation
   */
  this.createPrivatePost = (title, post, users, owner) => {
    return client.post('/posts', {
        archetype: 'private_message',
        target_usernames: users,
        title: title,
        raw: post
      }, {
        params: {
          api_username: owner && !util.isDiscourseAdmin(owner) ? owner : DISCOURSE_SYSTEM_USERNAME
        }
      })
      .catch((err) => {
        logger.error('Error creating topic')
        logger.error(err)
        return Promise.reject(err)
      })
  }

  /**
   * Gets a topic in Discourse
   * topicId: the id of the topic
   * username: the username to use to fetch the topic, for security purposes
   */
  this.getTopic = (topicId, username) => {
    return client.get(`/t/${topicId}.json`, {
        params: {
          api_username: util.isDiscourseAdmin(username) ? DISCOURSE_SYSTEM_USERNAME : username
        }
      })
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
    if (responseTo) {
      data += '&reply_to_post_number=' + responseTo;
    }
    return client.post('/posts', data, {
      params: {
        api_username: util.isDiscourseAdmin(username) ? DISCOURSE_SYSTEM_USERNAME : username
      }
    });
  }

  /**
   * Fetches posts from discourse
   * username: the name of the user to use to access the Discourse API
   * topicId: the id of the topic that is parent to the posts
   * postIds: array containing the list of posts that should be retrieved
   */
  this.getPosts = (username, topicId, postIds) => {

    logger.debug('Attempting to retrieve posts', postIds)
    var postIdsFilter = '';
    var separator = '';
    _(postIds).each(postId => {
      postIdsFilter += `${separator}${encodeURIComponent('post_ids[]')}=${postId}`;
      separator = '&';
    });

    return client.get(`/t/${topicId}/posts.json?${postIdsFilter}`, {
      params: {
        api_username: util.isDiscourseAdmin(username) ? DISCOURSE_SYSTEM_USERNAME : username
      }
    })
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
    return client.post('/topics/timings.json', parts.join('&'), {
      params: {
        api_username: username
      }
    });
  }

  /**
   * Changes trust level of existing user
   * user_id: user's discourse user_id
   * level: new trust level
   */
  this.changeTrustLevel = (user_id, level) => {
    logger.debug('Changing trust level of user in discourse:', user_id)
    return client.put(`/admin/users/${user_id}/trust_level`, {
      user_id: user_id,
      level: level,
    })
  }

  return this;
}

module.exports = Discourse;
