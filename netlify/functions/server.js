const express = require('express');
const serverless = require('serverless-http');
const app = express();
const path = require('path');

// Configuração de EJS
app.set('view engine', 'ejs');
app.set("views", path.join(__dirname, "api/public/views"));

app.get('/', (req, res) => {
  res.render('index', { title: 'Minha Aplicação' });
});

module.exports.handler = serverless(app);
