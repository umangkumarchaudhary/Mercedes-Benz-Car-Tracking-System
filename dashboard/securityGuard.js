const express = require("express");
const Vehicle = require("../models/vehicle"); // Assuming the vehicle model is in models folder
const router = express.Router();

// Fetch the number of vehicles entered today
router.get("/vehicles/today", async (req, res) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const count = await Vehicle.countDocuments({
      entryTime: { $gte: startOfDay },
    });

    res.json({ success: true, count });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error", error });
  }
});

module.exports = router;
