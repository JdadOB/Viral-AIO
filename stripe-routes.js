// stripe-routes.js — Stripe checkout, webhooks, subscription management
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const PLANS = {
  solo:          { priceId: 'price_1TR1dZIzJBgTHs31o4oU6b4w', name: 'Solo',          creators: 10  },
  small_agency:  { priceId: 'price_1TR1dtIzJBgTHs31Wvn65pcK', name: 'Small Agency',   creators: 30  },
  unlimited:     { priceId: 'price_1TR1e9IzJBgTHs31MT0gkwGz', name: 'Unlimited',      creators: 9999 },
};

module.exports = function mountStripeRoutes(app, { db, requireAuth, requireAdmin, logActivity, userRole }) {

  // ── Create checkout session ────────────────────────────────────────────────
  // POST /api/stripe/checkout  body: { plan: 'solo'|'small_agency'|'unlimited' }
  app.post('/api/stripe/checkout', async (req, res) => {
    const { plan, email } = req.body;
    const planConfig = PLANS[plan];
    if (!planConfig) return res.status(400).json({ error: 'Invalid plan' });

    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [{ price: planConfig.priceId, quantity: 1 }],
        success_url: `${process.env.APP_URL || 'https://viraltrack.org'}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.APP_URL || 'https://viraltrack.org'}/landing`,
        customer_email: email || undefined,
        metadata: { plan },
        subscription_data: {
          metadata: { plan },
        },
      });
      res.json({ url: session.url });
    } catch (err) {
      console.error('[Stripe:Checkout]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Stripe webhook ─────────────────────────────────────────────────────────
  // POST /api/stripe/webhook
  app.post('/api/stripe/webhook',
    require('express').raw({ type: 'application/json' }),
    async (req, res) => {
      const sig = req.headers['stripe-signature'];
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

      let event;
      try {
        if (webhookSecret) {
          event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
        } else {
          event = JSON.parse(req.body);
        }
      } catch (err) {
        console.error('[Stripe:Webhook] Invalid signature:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
      }

      try {
        switch (event.type) {

          case 'checkout.session.completed': {
            const session = event.data.object;
            const email = session.customer_email || session.customer_details?.email;
            const plan = session.metadata?.plan || 'solo';
            const customerId = session.customer;
            const subscriptionId = session.subscription;

            if (email) {
              // Create or update user account
              let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
              if (!user) {
                const password_hash = require('crypto').randomBytes(32).toString('hex');
                db.prepare(`INSERT INTO users (email, name, password_hash, role) VALUES (?, ?, ?, 'client')`)
                  .run(email, email.split('@')[0], password_hash);
                user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
                console.log('[Stripe] Created new user:', email);
              }
              // Store subscription info
              db.prepare(`INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, ?, ?)`)
                .run(user.id, 'stripe_customer_id', customerId);
              db.prepare(`INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, ?, ?)`)
                .run(user.id, 'stripe_subscription_id', subscriptionId);
              db.prepare(`INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, ?, ?)`)
                .run(user.id, 'stripe_plan', plan);
              db.prepare(`INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, ?, ?)`)
                .run(user.id, 'subscription_status', 'active');
              db.prepare(`INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, ?, ?)`)
                .run(user.id, 'max_creators', String(PLANS[plan]?.creators || 10));

              console.log(`[Stripe] Subscription activated: ${email} → ${plan}`);
            }
            break;
          }

          case 'customer.subscription.deleted':
          case 'customer.subscription.paused': {
            const sub = event.data.object;
            const customerId = sub.customer;
            // Find user by customer ID
            const setting = db.prepare(`SELECT user_id FROM user_settings WHERE key = 'stripe_customer_id' AND value = ?`).get(customerId);
            if (setting) {
              db.prepare(`INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, ?, ?)`)
                .run(setting.user_id, 'subscription_status', 'cancelled');
              console.log('[Stripe] Subscription cancelled for user:', setting.user_id);
            }
            break;
          }

          case 'customer.subscription.updated': {
            const sub = event.data.object;
            const customerId = sub.customer;
            const setting = db.prepare(`SELECT user_id FROM user_settings WHERE key = 'stripe_customer_id' AND value = ?`).get(customerId);
            if (setting) {
              const status = sub.status === 'active' ? 'active' : sub.status;
              db.prepare(`INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, ?, ?)`)
                .run(setting.user_id, 'subscription_status', status);
            }
            break;
          }
        }
      } catch (err) {
        console.error('[Stripe:Webhook] Handler error:', err.message);
      }

      res.json({ received: true });
    }
  );

  // ── Get subscription status ────────────────────────────────────────────────
  app.get('/api/stripe/subscription', requireAuth, (req, res) => {
    const uid = req.user.id;
    const plan     = db.prepare(`SELECT value FROM user_settings WHERE user_id = ? AND key = 'stripe_plan'`).get(uid);
    const status   = db.prepare(`SELECT value FROM user_settings WHERE user_id = ? AND key = 'subscription_status'`).get(uid);
    const maxCreators = db.prepare(`SELECT value FROM user_settings WHERE user_id = ? AND key = 'max_creators'`).get(uid);
    res.json({
      plan: plan?.value || null,
      status: status?.value || null,
      maxCreators: parseInt(maxCreators?.value || '0'),
    });
  });

  // ── Cancel subscription ────────────────────────────────────────────────────
  app.post('/api/stripe/cancel', requireAuth, async (req, res) => {
    const uid = req.user.id;
    const subSetting = db.prepare(`SELECT value FROM user_settings WHERE user_id = ? AND key = 'stripe_subscription_id'`).get(uid);
    if (!subSetting) return res.status(400).json({ error: 'No active subscription found' });
    try {
      await stripe.subscriptions.cancel(subSetting.value);
      db.prepare(`INSERT OR REPLACE INTO user_settings (user_id, key, value) VALUES (?, ?, ?)`)
        .run(uid, 'subscription_status', 'cancelled');
      logActivity(uid, req.user.name, userRole(req.user), 'subscription_cancelled', {});
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Customer portal (manage billing) ──────────────────────────────────────
  app.post('/api/stripe/portal', requireAuth, async (req, res) => {
    const uid = req.user.id;
    const custSetting = db.prepare(`SELECT value FROM user_settings WHERE user_id = ? AND key = 'stripe_customer_id'`).get(uid);
    if (!custSetting) return res.status(400).json({ error: 'No billing account found' });
    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: custSetting.value,
        return_url: `${process.env.APP_URL || 'https://viraltrack.org'}/#settings`,
      });
      res.json({ url: session.url });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Admin: list all subscribers ────────────────────────────────────────────
  app.get('/api/admin/subscribers', requireAdmin, (req, res) => {
    const rows = db.prepare(`
      SELECT u.id, u.email, u.name, u.created_at,
        (SELECT value FROM user_settings WHERE user_id = u.id AND key = 'stripe_plan') as plan,
        (SELECT value FROM user_settings WHERE user_id = u.id AND key = 'subscription_status') as status
      FROM users u
      WHERE EXISTS (SELECT 1 FROM user_settings WHERE user_id = u.id AND key = 'stripe_plan')
      ORDER BY u.created_at DESC
    `).all();
    res.json(rows);
  });

};
