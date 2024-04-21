"use strict";

const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.json({ message: "Hello, world!" });
});

app.get("/test", (req, res) => {
  res.json({ message: "test" });
});

const port = process.env.PORT;
app.listen(port, () => {
  console.log(`Listening on port ${port}`);
});
