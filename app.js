const http = require('http');

const PORT = process.env.PORT || 80;

const server = http.createServer((req, res) => {
  res.statusCode = 200;
  res.end('Hello from Dockerized Node.js App on EC2!');
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
// Triggering deployment
