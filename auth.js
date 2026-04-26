const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const bcrypt = require('bcryptjs');
const { db, seedUserDefaults } = require('./db');

passport.use(new LocalStrategy({ usernameField: 'email' }, (email, password, done) => {
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user || !user.password_hash) return done(null, false, { message: 'Invalid email or password' });
  if (!bcrypt.compareSync(password, user.password_hash)) return done(null, false, { message: 'Invalid email or password' });
  return done(null, user);
}));

if (process.env.GOOGLE_CLIENT_ID) {
  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
  }, (accessToken, refreshToken, profile, done) => {
    const email = profile.emails?.[0]?.value?.toLowerCase();
    let user = db.prepare('SELECT * FROM users WHERE google_id = ?').get(profile.id);
    if (!user && email) user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (user) {
      db.prepare('UPDATE users SET google_id = ?, name = ?, avatar_url = ? WHERE id = ?')
        .run(profile.id, profile.displayName, profile.photos?.[0]?.value ?? null, user.id);
      return done(null, db.prepare('SELECT * FROM users WHERE id = ?').get(user.id));
    }

    const { lastInsertRowid } = db.prepare(
      'INSERT INTO users (email, google_id, name, avatar_url) VALUES (?, ?, ?, ?)'
    ).run(email ?? null, profile.id, profile.displayName, profile.photos?.[0]?.value ?? null);

    seedUserDefaults(lastInsertRowid);
    return done(null, db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid));
  }));
}

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  done(null, user || false);
});

module.exports = passport;
