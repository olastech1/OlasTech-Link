const express = require('express');
const app = express();

app.use(express.json());

// Code Validation
app.post('/api/code/validate', require('../routes/code/validate'));

// Plans
app.get('/api/plans', require('../routes/plans'));

// Admin Routes
app.get('/api/admin/codes', require('../routes/admin/codes'));
app.post('/api/admin/generate', require('../routes/admin/generate'));
app.post('/api/admin/revoke', require('../routes/admin/revoke'));
app.get('/api/admin/payments', require('../routes/admin/payments'));
app.all('/api/admin/plans', require('../routes/admin/plans'));

// Payment Routes
app.post('/api/pay/init', require('../routes/pay/init'));
app.post('/api/pay/callback', require('../routes/pay/callback'));
app.post('/api/pay/recover', require('../routes/pay/recover'));

// Cron Routes
app.get('/api/cron/poller', require('../routes/cron/poller'));
app.get('/api/cron/sync', require('../routes/cron/sync'));
app.get('/api/cron/test', require('../routes/cron/test'));
app.get('/api/cron/migrate', require('../routes/cron/migrate'));

module.exports = app;
