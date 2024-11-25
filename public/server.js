const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const upload = multer({ dest: "uploads/" });

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const tokenkey = "Nvrtx3050$";

const DB =
  "mongodb+srv://rifo20131994:5dam6nBrdgxDdflu@cluster0.ncox7.mongodb.net/onlineCoach?retryWrites=true&w=majority&appName=Cluster0";

mongoose
  .connect(DB, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  .then(() => console.log("DB connection successful"));

app.use(express.json());
app.use("/uploads", express.static("uploads"));
app.use(express.static(path.join(__dirname, "public")));

const verifyToken = (req, res, next) => {
  const token = req.header("Authorization").replace("Bearer ", "");
  if (!token)
    return res.status(401).json({
      message: "Access denied. No token provided.",
    });

  try {
    const decoded = jwt.verify(token, tokenkey);
    req.user = decoded;
    next();
  } catch (ex) {
    res.status(400).json({ message: "Invalid token." });
  }
};

app.post("/login", async (req, res) => {
  const { userName: username, passWord: password } = req.body;

  try {
    const user = await User.findOne({ username });
    if (!user) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid username or password" });
    }

    const token = jwt.sign(
      { userId: user._id, username: user.username },
      tokenkey,
      { expiresIn: "1h" }
    );
    res.json({ token });
  } catch (err) {
    console.error("Error during login:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/signup", async (req, res) => {
  const { userName: username, passWord: password, email } = req.body;

  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      username,
      password: hashedPassword,
      email,
    });
    await newUser.save();

    const token = jwt.sign(
      { userId: newUser._id, username: newUser.username },
      tokenkey,
      { expiresIn: "24h" }
    );
    res.status(201).json({
      message: "User registered successfully",
      token,
    });
  } catch (err) {
    console.error("Error during signup:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.post("/profile", verifyToken, upload.single("photo"), async (req, res) => {
  const { age, weight, height } = req.body;
  const userId = req.user.userId;
  const photo = req.file.path;

  try {
    const newProfile = new Profile({
      userId,
      photo,
      age,
      weight,
      height,
    });
    await newProfile.save();
    res.status(201).json({
      message: "Profile created successfully",
      profile: newProfile,
    });
  } catch (err) {
    console.error("Error creating profile:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/viewmyprofile", verifyToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const profile = await Profile.findOne({
      userId,
    }).populate("userId", "username email");
    if (!profile) {
      return res.status(404).json({ message: "Profile not found" });
    }

    const photoUrl = `${req.protocol}://${req.get("host")}/${profile.photo}`;

    res.status(200).json({
      photo: photoUrl,
      age: profile.age,
      weight: profile.weight,
      height: profile.height,
      username: profile.userId.username,
      email: profile.userId.email,
    });
  } catch (err) {
    console.error("Error fetching profile:", err);
    res.status(500).json({ message: "Server error" });
  }
});

app.use(express.static("public"));

app.get("/", (req, res) => {
  console.log("Serving index.html");
  res.sendFile(path.join(__dirname, "index.html"));
});

io.on("connection", (socket) => {
  console.log("New client connected");

  socket.on("createGroup", (groupId) => {
    socket.join(groupId);
    console.log(`Group ${groupId} created and user joined`);
  });

  socket.on("joinGroup", (groupId) => {
    socket.join(groupId);
    console.log(`User joined group ${groupId}`);
  });

  socket.on("sendMessage", (data) => {
    const { groupId, message } = data;
    io.to(groupId).emit("message", message);
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected");
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
