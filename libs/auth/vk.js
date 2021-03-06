const VKontakteStrategy = require('passport-vkontakte').Strategy;
const passport = require('passport');

const _ = require('lodash');
const config = require('../config');
const social = require('../social');


passport.use(new VKontakteStrategy({
  clientID: process.env.VK_ID || config.get('vk_id'),
  clientSecret: process.env.VK_SECRET || config.get('vk_secret'),
  callbackURL: `${process.env.URL || `${config.get('base_url')}:${config.get('port')}/`}register/vk/callback`,
  profileFields: ['photo_max_orig'],
  lang: 'ru',
  passReqToCallback: true,
},
  ((req, accessToken, refreshToken, params, profile, next) => {
    const uniqueId = req.query.state.split(',')[2];

    const user = {
      userId: `vk_${profile.id}`,
      firstName: profile.name.givenName,
      lastName: profile.name.familyName,
      photo: _.chain(profile.photos).find(['type', 'photo_max_orig']).get('value', 'iceberg.png'),
      sex: profile.gender,
      socialLink: profile.profileUrl,
      vkToken: accessToken,
      accType: 'user',
    };

    social.createUser(user, uniqueId, accessToken)
      .then(socialUser => next(null, socialUser))
      .catch(err => next(err));
  })));

