// filepath: /c:/Users/user/Desktop/Backlify/generated/index.js
require('dotenv').config();
const express = require('express');
const app = express();

app.use(express.json());

// Require the actual route files
require('../src/routes/auth')(app);
require('../src/routes/deployments')(app);
require('../src/routes/projects')(app);
require('../src/routes/settings')(app);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});