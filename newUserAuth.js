const mongoose = require("mongoose");
const express = require("express");
const jwt = require("jsonwebtoken");
const cors = require("cors");
require("dotenv").config();

const router = express.Router();
const app = express();

// Middleware
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));

// List of allowed roles
const allowedRoles = [
  "Admin",
  "Security Guard",
  "Active Reception Technician",
  "Service Advisor",
  "Job Controller",
  "Bay Technician",
  "Final Inspection Technician",
  "Diagnosis Engineer",
  "Washing",
];

// MongoDB User Schema - With Password
const UserSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    mobile: { type: String, unique: true, required: true },
    email: { type: String, sparse: true, default: null },
    password: { type: String, required: true }, // Password field added
    role: { type: String, enum: allowedRoles, required: true }, // Fixed role selection
    isApproved: { type: Boolean, default: false }, // Approval status
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null }, // Admin who approved
    approvedAt: { type: Date, default: null }, // Approval timestamp
  },
  { timestamps: true }
);

const User = mongoose.models.User || mongoose.model("User", UserSchema);

// JWT Middleware
const authMiddleware = (req, res, next) => {
  const token = req.header("Authorization")?.replace("Bearer ", ""); // Read token from Authorization header
  if (!token) return res.status(401).json({ message: "Access Denied" });

  try {
    const verified = jwt.verify(token, process.env.JWT_SECRET);
    req.user = verified;
    next();
  } catch (error) {
    res.status(400).json({ message: "Invalid Token" });
  }
};

// ✅ Register User (Password Mandatory)
router.post("/register", async (req, res) => {
  try {
    const { name, mobile, email, password, role } = req.body;

    // Validate input
    if (!name || !mobile || !password || !allowedRoles.includes(role)) {
      return res.status(400).json({ message: "Invalid input data." });
    }

    // ✅ Check if user already exists by mobile
    const existingUser = await User.findOne({ mobile });
    if (existingUser) {
      return res.status(400).json({ message: "User with this mobile already registered" });
    }

    // ✅ If email is not provided, set it to null
    const formattedEmail = email && email.trim() !== "" ? email.trim().toLowerCase() : null;

    // ✅ Check if email already exists (only if provided)
    if (formattedEmail) {
      const existingEmailUser = await User.findOne({ email: formattedEmail });
      if (existingEmailUser) {
        return res.status(400).json({ message: "User with this email already registered" });
      }
    }

    // ✅ Auto-approve Admins
    const isApproved = role === "Admin";

    // ✅ Create new user with password hashing (you should hash the password in production)
    const newUser = new User({
      name,
      mobile,
      email: formattedEmail,
      password, // Store the plain password for now; hash it before saving in a real app.
      role,
      isApproved,
      approvedAt: isApproved ? new Date() : null,
    });

    await newUser.save();

    res.status(201).json({
      success: true,
      message: isApproved
        ? "Admin registered successfully. You can login immediately."
        : "User registered successfully. Please wait for admin approval before logging in.",
    });
  } catch (error) {
    console.error("Registration Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message || error,
    });
  }
});

// ✅ Login (Mobile & Password Required)
router.post("/login", async (req, res) => {
  try {
    const { mobile, password } = req.body;

    // Validate input
    if (!mobile || !password) {
      return res.status(400).json({ message: "Mobile and password are required." });
    }

    // Find user by Mobile
    const user = await User.findOne({ mobile });
    
    if (!user || user.password !== password) { // Add password check here
      return res.status(404).json({ message: "Invalid mobile or password." });
    }

    // Check if user is approved (bypass check for Admins)
    if (!user.isApproved && user.role !== "Admin") {
      return res.status(403).json({
        message: "Your account is pending approval. Please contact an administrator."
      });
    }

    // Generate JWT with a long expiration time to keep users logged in until app update
    const token = jwt.sign(
      { userId: user._id, name: user.name, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "365d" } // Set to one year for persistent login until app update
    );

    // Return token and user info in response
    res.json({
      success: true,
      token,
      user: {
        name: user.name,
        mobile: user.mobile,
        role: user.role,
        isApproved: user.isApproved
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error });
  }
});

// ✅ Logout API - No action needed since users stay logged in until app update.
router.post("/logout", (req, res) => {
  res.json({ success: true, message: "Logged out successfully" }); 
});

// ✅ Get All Users (Admin Access)
router.get("/users", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "Admin") {
      return res.status(403).json({ message: "Access Denied. Admins only." });
    }

    const users = await User.find();
    
	// Exclude passwords from the response for security reasons.
	const sanitizedUsers = users.map(user => ({
		_id:user._id,
		name:user.name,
		mobile:user.mobile,
		email:user.email,
		role:user.role,
		isApproved:user.isApproved,
		approvedAt:user.approvedAt
	}));

	res.json({ success:true , users:sanitizedUsers});
	
    
  } catch (error) {
   console.error(error);
   res.status(500).json({ success:false , message:"Server error", error});
  }
});

// ✅ Approve User (Admin Access)
router.put("/users/:userId/approve", authMiddleware, async (req, res) => {
  try {
     if (req.user.role !== "Admin") {
       return res.status(403).json({ message:"Access Denied. Admins only."});
     }

     const userId=req.params.userId;
     
     // Update approval status
     const updatedUser=await User.findByIdAndUpdate(
       userId,{
         isApproved:true,
         approvedBy:req.user.userId,
         approvedAt:new Date()
       },
       {new:true}
     );

     if(!updatedUser){
       return res.status(404).json({message:"User not found"});
     }

     res.json({
       success:true ,
       message:"User approved successfully", 
       user : updatedUser 
     });
   } catch(error){
     console.error(error);
     res.status(500).json({success:false , message:"Server error", error});
   }
});

// ✅ Get Pending Approval Users (Admin Access)
router.get("/users/pending", authMiddleware, async (req,res)=>{
	try{
		if(req.user.role!=="Admin"){
			return res.status(403).json({message:"Access Denied. Admins only."});
		}

		const pendingUsers=await User.find({isApproved:false});
		res.json({success:true , pendingUsers});
	}catch(error){
		console.error(error);
		res.status(500).json({success:false , message:"Server error", error});
	}
});

// ✅ Delete User (Admin Only)
router.delete("/users/:userId", authMiddleware , async(req,res)=>{
	try{
		if(req.user.role!=="Admin"){
			return res.status(403).json({message:"Access Denied. Admins only."});
		}

		const userId=req.params.userId;
		const deletedUser=await User.findByIdAndDelete(userId);

		if(!deletedUser){
			return res.status(404).json({message:"User not found"});
		}

		res.json({success:true , message:"User deleted successfully"});
	}catch(error){
		 console.error(error);
		 res.status(500).json({success:false , message:"Server error", error});
	}
});

router.post("/admin/add-user", authMiddleware, async (req, res) => {
    try {
      const { name, mobile, email, password, role, isApproved } = req.body;
  
      // ✅ Ensure only Admins can add users
      if (req.user.role !== "Admin") {
        return res.status(403).json({ success: false, message: "Access Denied. Admins only." });
      }
  
      // ✅ Validate input
      if (!name || !mobile || !password || !allowedRoles.includes(role)) {
        return res.status(400).json({ success: false, message: "Invalid input data." });
      }
  
      // ✅ Check if user already exists by mobile
      const existingUser = await User.findOne({ mobile });
      if (existingUser) {
        return res.status(400).json({ success: false, message: "User with this mobile already exists." });
      }
  
      // ✅ Hash password before saving
      const bcrypt = require("bcrypt");
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(password, saltRounds);
  
      // ✅ Create new user
      const newUser = new User({
        name,
        mobile,
        email: email?.trim() || null,
        password: hashedPassword,  // Store hashed password
        role,
        isApproved: isApproved || false,  // Default false unless specified
        approvedBy: req.user.userId,  // Admin who added the user
        approvedAt: isApproved ? new Date() : null,  // Timestamp if approved
      });
  
      await newUser.save();
  
      res.status(201).json({ success: true, message: "User added successfully.", user: newUser });
  
    } catch (error) {
      console.error("Admin Add User Error:", error);
      res.status(500).json({ success: false, message: "Server error", error });
    }
  });
  

// Export everything
module.exports = { router, authMiddleware, User };
