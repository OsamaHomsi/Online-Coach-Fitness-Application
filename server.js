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

const DB = "mongodb://localhost:27017/";

mongoose
  .connect(DB, {
    useNewUrlParser: true,
    useCreateIndex: true,
    useFindAndModify: false,
  })
  .then(() => console.log("DB connection successful"));

// User schema
const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true },
    password: { type: String, required: true },
    email: { type: String, required: true, unique: true },
  },
  { collection: "myusers" }
);

const User = mongoose.model("User", userSchema);

// Profile schema
const profileSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    photo: { type: String },
    age: { type: Number, required: true },
    weight: { type: Number, required: true },
    height: { type: Number, required: true },
  },
  { collection: "profiles" }
);

const Profile = mongoose.model("Profile", profileSchema);

// Group schema
const groupSchema = new mongoose.Schema({
  groupName: { type: String, required: true },
  groupId: { type: String, required: true, unique: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], // Add members field
});

const Group = mongoose.model("Group", groupSchema);

// Message schema
const messageSchema = new mongoose.Schema({
  groupId: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  message: { type: mongoose.Schema.Types.Mixed, required: true }, // Use Mixed type for message
  timestamp: { type: Date, default: Date.now },
});

const Message = mongoose.model("Message", messageSchema);

// Middleware to parse request bodies
app.use(express.json());

// Serve static files from the 'uploads' directory
app.use("/uploads", express.static("uploads"));

// Middleware to verify JWT token
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

// Login API
app.post("/login", async (req, res) => {
  const { email, passWord: password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign(
      { userId: user._id, username: user.username },
      tokenkey,
      { expiresIn: "24h" }
    );
    res.json({ token });
  } catch (err) {
    console.error("Error during login:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Signup API
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

// Create profile API
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

// View profile API
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

// Create Group API
app.post("/createGroup", verifyToken, async (req, res) => {
  const { groupName } = req.body;
  const groupId = new mongoose.Types.ObjectId().toString();

  try {
    const newGroup = new Group({
      groupName,
      groupId,
    });
    await newGroup.save();
    res.status(201).json({
      message: "Group created successfully",
      groupId,
    });
  } catch (err) {
    console.error("Error creating group:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Join Group API
app.post("/joinGroup", verifyToken, async (req, res) => {
  const { groupId } = req.body;
  const userId = req.user.userId;

  try {
    const group = await Group.findOne({ groupId });
    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    if (!group.members.includes(userId)) {
      group.members.push(userId); // Add user to group members
      await group.save();
    }

    // Emit an event to join a group on Socket.IO
    io.to(groupId).emit("joinGroup", groupId);

    res.status(200).json({
      message: `Joined group ${groupId} successfully`,
    });
  } catch (err) {
    console.error("Error joining group:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Send Message API
app.post("/sendMessage", verifyToken, async (req, res) => {
  const { groupId, message } = req.body;
  const userId = req.user.userId; // Get user ID from the token

  try {
    const newMessage = new Message({
      groupId,
      userId,
      message,
    });
    await newMessage.save();

    // Emit the message to other users in the group via Socket.IO
    io.to(groupId).emit("message", {
      groupId,
      userId,
      message,
      timestamp: newMessage.timestamp,
    });

    res.status(200).json({
      message: "Message sent successfully",
    });
  } catch (err) {
    console.error("Error sending message:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Get Messages from all joined groups API
app.get("/getMessages", verifyToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const groups = await Group.find({ members: userId }).select("groupId");
    const groupIds = groups.map((group) => group.groupId);
    console.log("Group IDs user belongs to:", groupIds); // Log the group IDs

    const messages = await Message.find({ groupId: { $in: groupIds } })
      .populate("userId", "username email")
      .sort({ timestamp: -1 });

    console.log("Retrieved messages:", messages); // Log the retrieved messages

    res.status(200).json({
      messages,
    });
  } catch (err) {
    console.error("Error retrieving messages:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// View Members API
app.get("/viewMembers/:groupId", verifyToken, async (req, res) => {
  const { groupId } = req.params;

  try {
    const group = await Group.findOne({ groupId }).populate(
      "members",
      "username"
    );
    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    const membersWithPhotos = await Promise.all(
      group.members.map(async (member) => {
        const profile = await Profile.findOne({ userId: member._id });
        const photoUrl = profile
          ? `${req.protocol}://${req.get("host")}/${profile.photo}`
          : null;
        return {
          _id: member._id,
          username: member.username,
          photo: photoUrl,
        };
      })
    );

    res.status(200).json({
      groupId,
      members: membersWithPhotos,
    });
  } catch (err) {
    console.error("Error retrieving group members:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// View Member Profile API
app.get("/viewMemberProfile/:userId", verifyToken, async (req, res) => {
  const { userId } = req.params;

  try {
    const user = await User.findById(userId).select("username email");
    const profile = await Profile.findOne({ userId });

    if (!user || !profile) {
      return res.status(404).json({ message: "Member profile not found" });
    }

    const photoUrl = `${req.protocol}://${req.get("host")}/${profile.photo}`;

    res.status(200).json({
      username: user.username,
      email: user.email,
      age: profile.age,
      weight: profile.weight,
      height: profile.height,
      photo: photoUrl,
    });
  } catch (err) {
    console.error("Error retrieving member profile:", err);
    res.status(500).json({ message: "Server error" });
  }
});
// View Groups API
app.get("/viewGroups", verifyToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const groups = await Group.find({ members: userId })
      .populate("members", "username")
      .select("groupName groupId");

    res.status(200).json({
      groups,
    });
  } catch (err) {
    console.error("Error retrieving groups:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Broadcast JSON Data API
app.post("/broadcastJsonData", verifyToken, async (req, res) => {
  const jsonData = req.body; // JSON data from request body
  const userId = req.user.userId;

  try {
    // Find all groups the user is a member of
    const groups = await Group.find({ members: userId });

    // Iterate over each group and send the JSON data as a message
    const messagePromises = groups.map(async (group) => {
      const newMessage = new Message({
        groupId: group.groupId,
        userId,
        message: jsonData, // Store JSON data directly
      });
      await newMessage.save();

      // Emit the message to the group via Socket.IO
      io.to(group.groupId).emit("message", {
        groupId: group.groupId,
        userId,
        message: jsonData, // Emit JSON data directly
        timestamp: newMessage.timestamp,
      });
    });

    // Wait for all message sending promises to complete
    await Promise.all(messagePromises);

    res.status(200).json({
      message: "JSON data sent to all joined groups successfully",
    });
  } catch (err) {
    console.error("Error sending JSON data:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Middleware to serve static files
app.use(express.static("public"));

// Root endpoint
app.get("/", (req, res) => {
  console.log("Serving index.html");
  res.sendFile(path.join(__dirname, "index.html"));
});

// Socket.IO connection
io.on("connection", (socket) => {
  console.log("New client connected");

  // User joins a group
  socket.on("joinGroup", (groupId) => {
    socket.join(groupId);
    console.log(`User joined group ${groupId}`);
  });

  // User sends a message
  socket.on("sendMessage", (data) => {
    const { groupId, message } = data;
    io.to(groupId).emit("message", message);
    console.log(`Message sent to group ${groupId}`);
  });

  // Handle disconnection
  socket.on("disconnect", () => {
    console.log("Client disconnected");
  });
});

// Start server on port 3000
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = app;
