const express = require('express');

const router = express.Router();

const passport = require('passport');

const Collection = require('.././dataModels/collection').Collection;
const User = require('.././dataModels/user').User;
const Link = require('.././dataModels/link').Link;
const mongoose = require('mongoose');

const validation = require('./validation/validator');
const validationParams = require('./validation/params');
const error = require('rest-api-errors');

const _ = require('lodash');

router.get('/:collectionId', passport.authenticate('bearer', { session: false }), (req, res, next) => {
  Collection.aggregate([
    {
      $match: { _id: mongoose.Types.ObjectId(req.params.collectionId) },
    },
    {
      $unwind: { path: '$links', preserveNullAndEmptyArrays: true },
    },
    {
      $lookup:
         {
           from: 'links',
           localField: 'links',
           foreignField: '_id',
           as: 'link',
         },
    },
    {
      $unwind: { path: '$link', preserveNullAndEmptyArrays: true },
    },
    {
      $unwind: { path: '$tags', preserveNullAndEmptyArrays: true },
    },
    {
      $lookup:
         {
           from: 'tags',
           localField: 'tags',
           foreignField: '_id',
           as: 'tag',
         },
    },

    {
      $unwind: { path: '$tag', preserveNullAndEmptyArrays: true },
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
      $addFields: { 'link.savedTimesCount': { $cond: { if: { $isArray: '$link.usersSaved' }, then: { $size: '$link.usersSaved' }, else: 0 } },
        'link.saved': { $cond: { if: { $and: [{ $isArray: '$link.usersSaved' }, { $in: [req.user.userId, '$link.usersSaved'] }] }, then: true, else: false } },
      },
    },
    {
      $group: {
        _id: '$_id',
        name: { $first: '$name' },
        author: { $first: '$author' },
        photo: { $first: '$photo' },
        color: { $first: '$color' },
        links: { $addToSet: '$link' },
        tags: { $addToSet: '$tag' },
        description: { $first: '$description' },
        usersSaved: { $first: '$usersSaved' },
      },
    },
    {
      $unwind: { path: '$links', preserveNullAndEmptyArrays: true },
    },
    {
      $lookup:
         {
           from: 'users',
           localField: 'links.userAdded',
           foreignField: 'userId',
           as: 'links.userAdded',
         },
    },
    {
      $unwind: { path: '$links.userAdded', preserveNullAndEmptyArrays: true },
    },
    {
      $group: {
        _id: '$_id',
        name: { $first: '$name' },
        author: { $first: '$author' },
        photo: { $first: '$photo' },
        color: { $first: '$color' },
        links: { $addToSet: '$links' },
        tags: { $first: '$tags' },
        description: { $first: '$description' },
        usersSaved: { $first: '$usersSaved' },
      },
    },
    {
      $addFields: {
        saved: { $cond: { if: { $and: [{ $isArray: '$usersSaved' }, { $in: [req.user.userId, '$usersSaved'] }] }, then: true, else: false } },
        savedTimesCount: { $size: '$usersSaved' },
      },
    },
    {
      $project: { 'author.salt': 0,
        'author._id': 0,
        usersSaved: 0,
        'author.hash': 0,
        'author.banned': 0,
        'author.created': 0,
        'author.createdCollections': 0,
        'author.savedCollections': 0,
        'author.savedLinks': 0,
        'author.addedLinks': 0,
        'links.userAdded._id': 0,
        'links.usersSaved': 0,
        'links.userAdded.hash': 0,
        'links.userAdded.salt': 0,
        'links.userAdded.banned': 0,
        'links.userAdded.created': 0,
        'links.userAdded.__v': 0,
        'links.userAdded.accType': 0,
        'links.userAdded.description': 0,
        'links.userAdded.createdCollections': 0,
        'links.userAdded.savedCollections': 0,
        'links.userAdded.addedLinks': 0,
        'links.userAdded.savedLinks': 0,
        'author.__v': 0,
        'links.__v': 0,
        'tags.__v': 0,
        'tags.textColor': 0,
        'tags.color': 0,
      },
    },
  ])
    .then((returnedCollection) => {
      if (!returnedCollection || !returnedCollection.length) {
        throw new error.NotFound('NO_COLLECTIONS_ERR', 'Collections not found');
      } else {
        const collection = returnedCollection[0];
        if (!_.find(collection.links, 'userAdded')) { // FIXME: очень некрасивый костыль
          collection.links = [];
        }
        res.json({ collection });
      }
    })
    .catch(err => next(err));
});

router.post('/', passport.authenticate('bearer', { session: false }), validation(validationParams.collection), (req, res, next) => {
  req.body.authorId = req.user.userId;
  req.body.tags = req.body.tags.map(tag => mongoose.Types.ObjectId(tag));
  const newCollection = new Collection(req.body);
  newCollection.save()
    .then(collection => User.findOneAndUpdate({ userId: req.user.userId },
      { $push: { createdCollections: { bookmarkId: collection._id } } })
      .then((user) => {
        if (!user) {
          throw new error.NotFound('NO_USER_ERR', 'User not found');
        }
        res.json({ collection });
      }))
    .catch(err => next(err));
});

router.post('/addLink/:collectionId/:linkId', validation(validationParams.description), passport.authenticate('bearer', { session: false }), (req, res, next) => { // FIXME: проверка по url
  Collection.findOneAndUpdate({ _id: mongoose.Types.ObjectId(req.params.collectionId) },
    { $addToSet: { links: mongoose.Types.ObjectId(req.params.linkId) } })
    .then((collection) => {
      if (!collection) {
        throw new error.NotFound('NO_COLLECTION_ERR', 'Collection not found, cannot update this collection');
      }
      if (req.body.description) {
        return Link.findOneAndUpdate({ _id: mongoose.Types.ObjectId(req.params.linkId) }, { description: req.body.description })
          .then((link) => {
            if (!link) {
              throw new error.NotFound('NO_LINK_ERR', 'Link not found, cannot update this link description');
            }
            res.end();
          });
      }
      return res.end();
    })
    .catch(err => next(err));
});


module.exports = router;
