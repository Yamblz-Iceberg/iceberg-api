const mongoose = require('../libs/db/mongoose');
const findOrCreate = require('findorcreate-promise');

const Schema = mongoose.Schema;

const Collection = new Schema({
  name: {
    type: String,
    required: true,
  },
  authorId: {
    type: String,
    required: true,
  },
  tags: {
    type: [Schema.Types.ObjectId],
  },
  description: {
    type: String,
    default: '',
  },
  photo: {
    type: String,
  },
  links: {
    type: [Schema.Types.ObjectId],
  },
  color: {
    type: String,
    default: '#0476fc',
  },
  usersSaved: {
    type: Array,
  },
  textColor: {
    type: String,
  },
  created: {
    type: Date,
    default: Date.now,
  },
  closed: {
    type: Boolean,
    default: false,
  },
});

Collection.plugin(findOrCreate);

Collection.index({ name: 'text' });

module.exports.Collection = mongoose.model('Collection', Collection);
