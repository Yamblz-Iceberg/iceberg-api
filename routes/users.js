const express = require('express');

const router = express.Router();
const User = require('.././dataModels/user').User;
const Collection = require('.././dataModels/collection').Collection;
const Link = require('.././dataModels/link').Link;
const mongoose = require('mongoose');
const passport = require('passport');
const validation = require('./validation/validator');
const validationParams = require('./validation/params');
const error = require('rest-api-errors');
const status = require('../libs/auth/status');
const social = require('../libs/social');


router.all('/*', passport.authenticate('bearer', { session: false }));

router.get('/:userId?', (req, res, next) => {
  User.findOne({ userId: req.params.userId ? req.params.userId : req.user.userId },
    { hash: 0, salt: 0, id: 0, __v: 0, bookmarks: 0, metrics: 0, savedLinks: 0, vkToken: 0, fbToken: 0, yaToken: 0 })
    .then(user => (!user ? new error.NotFound('NO_USER_ERR', 'User cannot be found') : user))
    .then(user => res.json(user))
    .catch(err => next(err));
});

router.put('/', validation(validationParams.editUser), (req, res, next) => {
  User.findOneAndUpdate({ userId: req.user.userId }, req.body)
    .then(user => (!user ? new error.NotFound('NO_USER_ERR', 'User cannot be found') : user))
    .then(() => res.end())
    .catch(err => next(err));
});

router.delete('/', (req, res, next) => {
  User.findOneAndRemove({ userId: req.user.userId })
    .then(user => (!user ? new error.NotFound('NO_USER_ERR', 'User cannot be found') : user))
    .then(() => res.end())
    .catch(err => next(err));
});

router.get('/social/friends', status.accountTypeMiddleware, (req, res, next) => {
  social.getFriends(req.user)
    .then(friends => res.json({ friends }))
    .catch(err => next(err));
});

router.all('/bookmarks/:type/:id?', validation(validationParams.bookmarks), passport.authenticate('bearer', { session: false }), (req, res, next) => {
  const SAVED_COLLECTIONS = 'savedCollections';
  const CREATED_COLLECTIONS = 'createdCollections';
  const SAVED_LINKS = 'savedLinks';
  const ADDED_LINKS = 'addedLinks';

  const addingId = mongoose.Types.ObjectId(req.params.id);

  const types = [SAVED_COLLECTIONS, SAVED_LINKS];
  const myTypes = [CREATED_COLLECTIONS, ADDED_LINKS];

  if (['GET', 'PUT', 'DELETE'].indexOf(req.method) === -1 && types.indexOf(req.params.type) !== -1) {
    return next(new error.MethodNotAllowed('NOT_ALLOWED_ERR', 'Method not allowed for saved content'));
  } else if (['GET', 'DELETE'].indexOf(req.method) === -1 && myTypes.indexOf(req.params.type) !== -1) {
    return next(new error.MethodNotAllowed('NOT_ALLOWED_ERR', 'Method not allowed for user created content'));
  } else if ((req.method !== 'GET' && req.query.userId) || (req.params.type !== CREATED_COLLECTIONS && req.query.userId)) {
    return next(new error.MethodNotAllowed('NOT_ALLOWED_ERR', 'Method not allowed, if userId specified only GET method is allowed'));
  }

  let bookmarksAction = {};
  let userAction = {};
  let userDuplicateCheck = { userId: req.query.userId ? req.query.userId : req.user.userId };

  const collectionsActionDestination = { bookmarks: { bookmarkId: addingId, type: SAVED_COLLECTIONS } };
  const collectionsCreatedActionDestination = { bookmarks: { bookmarkId: addingId, type: CREATED_COLLECTIONS } };
  const linksActionDestination = { bookmarks: { bookmarkId: addingId, type: SAVED_LINKS } };
  const linksActionAddedDestination = { bookmarks: { bookmarkId: addingId, type: ADDED_LINKS } };

  const userActionDestination = { usersSaved: req.user.userId };

  const mongoCollection = (req.params.type === SAVED_COLLECTIONS || req.params.type === CREATED_COLLECTIONS) ? Collection : Link;

  if (req.method === 'PUT' && req.params.id && types.indexOf(req.params.type) !== -1) {
    bookmarksAction = { $addToSet: userActionDestination };
    userAction = { $addToSet: req.params.type === SAVED_COLLECTIONS ? collectionsActionDestination : linksActionDestination };
    userDuplicateCheck = { userId: req.user.userId, 'bookmarks.bookmarkId': { $ne: addingId } };
  } else if (req.method === 'DELETE' && req.params.id) {
    switch (req.params.type) {
    case (SAVED_COLLECTIONS): userAction = { $pull: collectionsActionDestination };
      bookmarksAction = { $pull: userActionDestination };
      break;
    case (CREATED_COLLECTIONS): userAction = { $pull: collectionsCreatedActionDestination };
      break;
    case (SAVED_LINKS): userAction = { $pull: linksActionDestination };
      bookmarksAction = { $pull: userActionDestination };
      break;
    case (ADDED_LINKS): userAction = { $pull: linksActionAddedDestination };
      break;
    default:
      return next(new error.BadRequest('BOOKMARKS_ERR', 'Bookmarks destination not found'));
    }
  }

  return mongoCollection.findOneAndUpdate({ _id: addingId },
    bookmarksAction)
    .then((bookmark) => {
      if (!bookmark && req.params.id) {
        throw new error.NotFound('NO_BOOKMARKS_ERR', 'Bookmarks not found');
      }
      return User.findOneAndUpdate(userDuplicateCheck,
        userAction)
        .then((user) => {
          if (!user) {
            throw new error.NotFound('BOOKMARK_ADD_ERR', 'User not found');
          }
          if (req.method === 'GET') {
            if (req.params.type === SAVED_COLLECTIONS || req.params.type === CREATED_COLLECTIONS) {
              return Collection.aggregate([
                {
                  $match: { _id: { $in: user.bookmarks.map(bookmarkElem => (bookmarkElem.type === req.params.type ?
                    bookmarkElem.bookmarkId : undefined)).filter(Boolean) } },
                },
                {
                  $unwind: { path: '$author', preserveNullAndEmptyArrays: true },
                },
                {
                  $lookup:
                    {
                      from: 'users',
                      localField: 'authorId',
                      foreignField: 'userId',
                      as: 'author',
                    },
                },
                {
                  $unwind: { path: '$author', preserveNullAndEmptyArrays: true },
                },
                {
                  $lookup:
                    {
                      from: 'users',
                      localField: '_id',
                      foreignField: 'metrics.contentId',
                      as: 'metrics',
                    },
                },
                {
                  $unwind: { path: '$metrics', preserveNullAndEmptyArrays: true },
                },
                {
                  $addFields: {
                    metrics: {
                      $filter: {
                        input: '$metrics.metrics',
                        as: 'metric',
                        cond: { $and: [
                          { $eq: ['$$metric.contentId', '$_id'] },
                          { $eq: ['$metrics.userId', req.user.userId] }] },
                      },
                    },
                  },
                },
                {
                  $unwind: { path: '$metrics', preserveNullAndEmptyArrays: true },
                },
                {
                  $group: {
                    _id: '$_id',
                    name: { $first: '$name' },
                    author: { $first: '$author' },
                    photo: { $first: '$photo' },
                    color: { $first: '$color' },
                    created: { $first: '$created' },
                    links: { $first: '$links' },
                    metrics: { $addToSet: '$metrics' },
                    closed: { $first: '$closed' },
                  },
                },
                {
                  $unwind: { path: '$metrics', preserveNullAndEmptyArrays: true },
                },
                {
                  $addFields: {
                    linksCount: { $size: '$links' },
                  },
                },
                {
                  $project: {
                    usersSaved: 0,
                    metrics: {
                      _id: 0,
                      type: 0,
                      counter: 0,
                      contentId: 0,
                    },
                    author: {
                      salt: 0,
                      _id: 0,
                      hash: 0,
                      banned: 0,
                      created: 0,
                      accType: 0,
                      bookmarks: 0,
                      metrics: 0,
                      vkToken: 0,
                      fbToken: 0,
                      yaToken: 0,
                      socialLink: 0,
                      sex: 0,
                      links: 0,
                      __v: 0,
                    },
                    tags: {
                      __v: 0,
                      textColor: 0,
                      color: 0,
                    },
                  },
                },
                {
                  $match: (req.query.filter === 'new') ? { $or: [{ 'metrics.opened': null }, { 'metrics.opened': false }] } :
                    (req.query.filter === 'opened') ? { 'metrics.opened': true } :
                      { _id: { $exists: true } },
                },
                {
                  $match: req.query.userId && req.query.userId !== req.user.userId ? { closed: false } : { _id: { $exists: true } },
                },
                {
                  $sort: { 'metrics.addTime': -1 },
                },
              ])
                .then(collections => res.json({ collections }));
            }
            return Link.aggregate([
              {
                $match: { _id: { $in: user.bookmarks.map(bookmarkElem => (bookmarkElem.type === req.params.type ?
                  bookmarkElem.bookmarkId : undefined)).filter(Boolean) } },
              },
              {
                $unwind: { path: '$author', preserveNullAndEmptyArrays: true },
              },
              {
                $lookup:
                   {
                     from: 'users',
                     localField: 'userAdded',
                     foreignField: 'userId',
                     as: 'userAdded',
                   },
              },
              {
                $unwind: { path: '$userAdded', preserveNullAndEmptyArrays: true },
              },
              {
                $lookup:
                   {
                     from: 'users',
                     localField: '_id',
                     foreignField: 'metrics.contentId',
                     as: 'metrics',
                   },
              },
              {
                $unwind: { path: '$metrics', preserveNullAndEmptyArrays: true },
              },
              {
                $addFields: {
                  metrics: {
                    $filter: {
                      input: '$metrics.metrics',
                      as: 'metric',
                      cond: { $and: [
                        { $eq: ['$$metric.contentId', '$_id'] },
                        { $eq: ['$metrics.userId', req.user.userId] }] },
                    },
                  },
                },
              },
              {
                $unwind: { path: '$metrics', preserveNullAndEmptyArrays: true },
              },
              {
                $group: {
                  _id: '$_id',
                  name: { $first: '$name' },
                  userAdded: { $first: '$userAdded' },
                  photo: { $first: '$photo' },
                  description: { $first: '$description' },
                  favicon: { $first: '$favicon' },
                  likes: { $first: '$likes' },
                  url: { $first: '$url' },
                  metrics: { $addToSet: '$metrics' },
                },
              },
              {
                $unwind: { path: '$metrics', preserveNullAndEmptyArrays: true },
              },
              {
                $project: {
                  usersSaved: 0,
                  userAdded: {
                    salt: 0,
                    bookmarks: 0,
                    vkToken: 0,
                    fbToken: 0,
                    yaToken: 0,
                    socialLink: 0,
                    sex: 0,
                    _id: 0,
                    hash: 0,
                    banned: 0,
                    created: 0,
                    accType: 0,
                    metrics: 0,
                    __v: 0,
                  },
                  metrics: {
                    _id: 0,
                    contentId: 0,
                    type: 0,
                    bookmarkId: 0,
                    counter: 0,
                    __v: 0,
                  },
                },
              },
              {
                $match:
                (req.query.filter === 'new') ?
                  { $or: [{ 'metrics.opened': null }, { 'metrics.opened': false }] } :
                  (req.query.filter === 'opened') ?
                    { 'metrics.opened': true } :
                    { _id: { $exists: true } },
              },
              {
                $sort: { 'metrics.addTime': -1 },
              },
            ])
              .then(links => res.json({ links }));
          } else if (req.method === 'DELETE' && myTypes.indexOf(req.params.type) !== -1) {
            return mongoCollection.findOneAndRemove(req.params.type === CREATED_COLLECTIONS ?
              { _id: addingId, authorId: req.user.userId } :
              { _id: addingId, userAdded: req.user.userId })
              .then((deletedContent) => {
                if (!deletedContent) {
                  throw new error.NotFound('CONTENT_DELETE_ERR', 'Nothing to delete');
                }
                // TODO: при удалении ссылок, удлаять из id из коллекции
                res.end();
              });
          }
          return res.end();
        });
    })
    .catch(err => next(err));
});

module.exports = router;
