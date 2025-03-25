const express = require("express");
const Vehicle = require("./models/vehicle"); // Ensure correct path for Vehicle model
const router = express.Router();

/**
 * ✅ API 1: Stage-Wise Performance (Avg. Time Per Stage)
 * Calculates total and average time spent per stage.
 */
router.get("/dashboard/stage-performance", async (req, res) => {
  try {
    const { days } = req.query;
    let query = {}; // Default: fetch all data

    if (days && days !== "all") {
      const daysInt = parseInt(days);
      if (!isNaN(daysInt)) {
        let filterDate = new Date();
        filterDate.setDate(filterDate.getDate() - daysInt);
        query.entryTime = { $gte: filterDate };
      }
    }

    const vehicles = await Vehicle.find(query);
    const stageData = {};

    vehicles.forEach((vehicle) => {
      vehicle.stages.forEach((stage) => {
        if (stage.eventType === "Start") {
          if (!stageData[stage.stageName]) {
            stageData[stage.stageName] = { totalTime: 0, count: 0 };
          }

          let endStage;
          if (stage.stageName === "Job Card Creation + Customer Approval") {
            endStage = vehicle.stages.find(
              (s) => s.stageName === "Bay Allocation Started" && s.eventType === "Start"
            );
          } else if (stage.stageName === "Bay Allocation Started") {
            endStage = vehicle.stages.find(
              (s) => s.stageName.startsWith("Bay Work:") && s.eventType === "Start"
            );
          } else {
            endStage = vehicle.stages.find(
              (s) => s.stageName === stage.stageName && s.eventType === "End"
            );
          }

          if (endStage) {
            const duration = new Date(endStage.timestamp) - new Date(stage.timestamp);
            stageData[stage.stageName].totalTime += duration;
            stageData[stage.stageName].count += 1;
          }
        }
      });
    });

    const avgStageTimes = Object.keys(stageData).map((stageName) => ({
      stageName,
      avgTime: stageData[stageName].count > 0 ? stageData[stageName].totalTime / stageData[stageName].count : 0,
    }));

    res.json({ success: true, avgStageTimes, filterDays: days || "All Data" });
  } catch (error) {
    console.error("❌ Error in /dashboard/stage-performance:", error);
    res.status(500).json({ success: false, message: "Server error", error });
  }
});

  

  router.get("/dashboard/vehicle/:vehicleNumber", async (req, res) => {
    try {
      const { vehicleNumber } = req.params;
      const formattedVehicleNumber = vehicleNumber.trim().toUpperCase();
  
      // Fetch vehicle data
      const vehicle = await Vehicle.findOne({ vehicleNumber: formattedVehicleNumber }).sort({ entryTime: -1 });
  
      if (!vehicle) {
        return res.status(404).json({ success: false, message: "Vehicle not found." });
      }
  
      // Extract stage timeline
      const stageTimeline = [];
      let currentStage = null;
  
      vehicle.stages.forEach(stage => {
        if (stage.eventType === "Start") {
          let endStage;
          let duration = null;
  
          if (stage.stageName === "Job Card Creation + Customer Approval") {
            // End time is when Bay Allocation starts
            endStage = vehicle.stages.find(s => s.stageName === "Bay Allocation Started" && s.eventType === "Start");
          } else if (stage.stageName === "Bay Allocation Started") {
            // End time is when Maintenance starts
            endStage = vehicle.stages.find(s => s.stageName === "Maintenance Started" && s.eventType === "Start");
          } else {
            // Normal End event
            endStage = vehicle.stages.find(s => s.stageName === stage.stageName && s.eventType === "End");
          }
  
          if (endStage) {
            duration = new Date(endStage.timestamp) - new Date(stage.timestamp);
          } else {
            currentStage = stage.stageName; // If no end event, vehicle is still in this stage
          }
  
          stageTimeline.push({
            stageName: stage.stageName,
            startTime: stage.timestamp,
            endTime: endStage ? endStage.timestamp : null,
            duration: duration ? formatTime(duration) : "Still In Progress"
          });
        }
      });
  
      res.json({ 
        success: true, 
        vehicleNumber: formattedVehicleNumber, 
        currentStage, 
        stageTimeline 
      });
  
    } catch (error) {
      console.error("Error in /dashboard/vehicle/:vehicleNumber:", error);
      res.status(500).json({ success: false, message: "Server error", error });
    }
  });
  

/**
 * ✅ API 2: Count Unique Vehicles Per Stage
 * Counts how many vehicles entered each stage.
 */

router.get("/dashboard/vehicle-count-per-stage", async (req, res) => {
  try {
    const { days } = req.query;
    let query = {}; // Default: fetch all data

    if (days && days !== "all") {
      const daysInt = parseInt(days);
      if (!isNaN(daysInt)) {
        let filterDate = new Date();
        filterDate.setDate(filterDate.getDate() - daysInt);
        query.entryTime = { $gte: filterDate };
      }
    }

    const allVehicles = await Vehicle.find(query);

    let stageCount = {}; // Store unique vehicle count per stage

    allVehicles.forEach((vehicle) => {
      let uniqueStages = new Set();
      vehicle.stages.forEach((stage) => uniqueStages.add(stage.stageName));

      uniqueStages.forEach((stage) => {
        stageCount[stage] = (stageCount[stage] || 0) + 1;
      });
    });

    let response = Object.keys(stageCount).map((stageName) => ({
      stageName,
      totalVehicles: stageCount[stageName],
    }));

    res.json({ success: true, vehicleCountPerStage: response, filterDays: days || "All Data" });
  } catch (error) {
    console.error("❌ Error in /dashboard/vehicle-count-per-stage:", error);
    res.status(500).json({ success: false, message: "Server error", error });
  }
});


router.get("/dashboard/all-vehicles", async (req, res) => {
  try {
    // Fetch all vehicles from the database
    const vehicles = await Vehicle.find().sort({ entryTime: -1 });

    if (!vehicles || vehicles.length === 0) {
      return res.status(404).json({ success: false, message: "No vehicles found." });
    }

    // Process each vehicle to extract stage timeline and current stage
    const vehicleData = vehicles.map(vehicle => {
      let currentStage = null;
      const stageTimeline = [];

      // ✅ Add "Security In" at the beginning with only entryTime
      stageTimeline.push({
        stageName: "Security IN",
        startTime: vehicle.entryTime, // Only Entry Time here
        endTime: null, // No Exit Time
        duration: null // No duration
      });

      vehicle.stages.forEach(stage => {
        if (stage.eventType === "Start") {
          let endStage;
          let duration = null;

          if (stage.stageName === "Job Card Creation + Customer Approval") {
            // End time is when Bay Allocation starts
            endStage = vehicle.stages.find(s => s.stageName === "Bay Allocation Started" && s.eventType === "Start");
          } else if (stage.stageName === "Bay Allocation Started") {
            // 🔥 Fix: Now matches "Bay Work: PM" or other types
            endStage = vehicle.stages.find(s => s.stageName.startsWith("Bay Work:") && s.eventType === "Start");
          } else {
            // Normal End event
            endStage = vehicle.stages.find(s => s.stageName === stage.stageName && s.eventType === "End");
          }

          if (endStage) {
            duration = new Date(endStage.timestamp) - new Date(stage.timestamp);
          } else {
            currentStage = stage.stageName; // If no end event, vehicle is still in this stage
          }

          // ✅ Push all normal stages except Security Gate
          if (stage.stageName !== "Security Gate") {
            stageTimeline.push({
              stageName: stage.stageName,
              startTime: stage.timestamp,
              endTime: endStage ? endStage.timestamp : null,
              duration: duration ? formatTime(duration) : "Still In Progress"
            });
          }
        }
      });

      // ✅ Change "Security Gate" to "Security Out" for exit time
      if (vehicle.exitTime) {
        stageTimeline.push({
          stageName: "Security Out", // 🔥 Fix: Renaming Security Gate to Security Out
          startTime: null, // No Entry Time
          endTime: vehicle.exitTime, // Only Exit Time here
          duration: null // No duration
        });
      }

      return {
        vehicleNumber: vehicle.vehicleNumber,
        currentStage,
        stageTimeline
      };
    });

    res.json({ success: true, vehicles: vehicleData });

  } catch (error) {
    console.error("Error in /dashboard/all-vehicles:", error);
    res.status(500).json({ success: false, message: "Server error", error });
  }
});



const formatTime = (ms) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  };
  

module.exports = router;
