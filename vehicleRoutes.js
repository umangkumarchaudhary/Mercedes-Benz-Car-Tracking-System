const express = require("express");
const router = express.Router();
const Vehicle = require("./models/vehicle");

// ✅ 1️⃣ POST: Handle Vehicle Check-in and Stage Updates

router.post("/vehicle-check", async (req, res) => {
  console.log("🔹 Incoming Request Data:", req.body);

  try {
    const {
      vehicleNumber,
      role,
      stageName,
      eventType,
      inKM,
      outKM,
      inDriver,
      outDriver,
      workType,
      bayNumber,
    } = req.body;

    if (!vehicleNumber || !role || !stageName || !eventType) {
      console.log("❌ Missing required fields");
      return res.status(400).json({ success: false, message: "Required fields are missing." });
    }

    const formattedVehicleNumber = vehicleNumber.trim().toUpperCase();

    // ✅ Check if Vehicle Exists
    let vehicle = await Vehicle.findOne({ vehicleNumber: formattedVehicleNumber }).sort({ entryTime: -1 });

    // ✅ Case 1: New Vehicle Entry
    if (!vehicle || (vehicle.exitTime && new Date(vehicle.exitTime) <= new Date())) {
      // If no vehicle exists or the vehicle has exited, create a new entry
      vehicle = new Vehicle({
        vehicleNumber: formattedVehicleNumber,
        entryTime: new Date(),
        exitTime: null, // Exit time starts as null
        stages: [
          {
            stageName,
            role,
            eventType,
            timestamp: new Date(),
            inKM: role === "Security Guard" && eventType === "Start" ? inKM : null,
            outKM: role === "Security Guard" && eventType === "End" ? outKM : null,
            inDriver: role === "Security Guard" && eventType === "Start" ? inDriver : null,
            outDriver: role === "Security Guard" && eventType === "End" ? outDriver : null,
            workType: role === "Bay Technician" && eventType === "Start" ? workType || null : null,
            bayNumber: role === "Bay Technician" && eventType === "Start" ? bayNumber || null : null,
          },
        ],
      });

      await vehicle.save();
      return res.status(201).json({ success: true, newVehicle: true, message: "New vehicle entry recorded.", vehicle });
    }

    // ✅ Case 2: Update Existing Vehicle Entry
    if (eventType === "Start") {
      // Create a specific stage name for bay work that includes the work type
      let actualStageName = stageName;
      if (role === "Bay Technician" && workType) {
        // Format a more specific stage name for bay work
        actualStageName = `Bay Work: ${workType}`;
      }

      // **IMPORTANT: Log the actualStageName**
      console.log(`➡️ Starting stage: ${actualStageName} for ${formattedVehicleNumber}`);

      // Get all stages with this specific stage name (including the work type for bay work)
      const relatedStages = vehicle.stages.filter(stage => stage.stageName === actualStageName);
      const lastStage = relatedStages.length > 0 ? relatedStages[relatedStages.length - 1] : null;

      // Check if this is a bay-related stage
      const isBayRelatedStage = stageName === "Bay Allocation Started" || stageName.includes("Bay");

      // For regular (non-bay) stages, apply the original logic
      if (!isBayRelatedStage) {
        const regularRelatedStages = vehicle.stages.filter(stage => stage.stageName === stageName);
        const lastRegularStage = regularRelatedStages.length > 0 ? regularRelatedStages[regularRelatedStages.length - 1] : null;

        if (lastRegularStage && lastRegularStage.eventType === "End") {
          console.log(`❌ Cannot restart ${stageName} for ${formattedVehicleNumber}, it has already been completed.`);
          return res.status(400).json({ success: false, message: `Cannot restart ${stageName}. It has already been completed.` });
        }

        if (lastRegularStage && lastRegularStage.eventType === "Start") {
          console.log(`❌ ${stageName} has already started for ${formattedVehicleNumber}`);
          return res.status(400).json({ success: false, message: `${stageName} has already started. Complete it before starting again.` });
        }
      }

      // ✅ Store the new stage with the specific stage name
      vehicle.stages.push({
        stageName: actualStageName,
        role,
        eventType: "Start",
        timestamp: new Date(),
        inKM: role === "Security Guard" ? inKM : null,
        inDriver: role === "Security Guard" ? inDriver : null,
        workType: role === "Bay Technician" ? workType || null : null,
        bayNumber: role === "Bay Technician" ? bayNumber || null : null,
      });

      await vehicle.save();
      return res.status(200).json({ success: true, message: `${actualStageName} started.`, vehicle });
    }

    if (eventType === "End") {
      // Create a specific stage name for bay work that includes the work type (same as in Start)
      let actualStageName = stageName;
      if (role === "Bay Technician" && workType) {
        actualStageName = `Bay Work: ${workType}`;
      }

      // **IMPORTANT: Log the actualStageName**
      console.log(`➡️ Ending stage: ${actualStageName} for ${formattedVehicleNumber}`);

      // Get all stages with this specific stage name
      const relatedStages = vehicle.stages.filter(stage => stage.stageName === actualStageName);
      const lastStage = relatedStages.length > 0 ? relatedStages[relatedStages.length - 1] : null;

      // Check if this is a bay-related stage
      const isBayRelatedStage = stageName === "Bay Allocation Started" || stageName.includes("Bay");

      // For non-bay stages, use the original logic
      if (!isBayRelatedStage) {
        const regularRelatedStages = vehicle.stages.filter(stage => stage.stageName === stageName);
        const lastRegularStage = regularRelatedStages.length > 0 ? regularRelatedStages[regularRelatedStages.length - 1] : null;

        if (!lastRegularStage || lastRegularStage.eventType !== "Start") {
          console.log(`❌ ${stageName} was not started for ${formattedVehicleNumber}, cannot end.`);
          return res.status(400).json({ success: false, message: `${stageName} was not started.` });
        }
      }

      // ✅ Prevent multiple "End" events within 10 seconds (keep this for all stages)
      if (lastStage) {
        const timeDifference = (new Date() - new Date(lastStage.timestamp)) / 1000; // Convert to seconds
        if (timeDifference < 10) {
          console.log(`❌ Wait at least 10 seconds before completing ${actualStageName} for ${formattedVehicleNumber}.`);
          return res.status(400).json({ success: false, message: `Wait at least 10 seconds before completing ${actualStageName}.` });
        }
      }

      // ✅ Store `outKM` and `outDriver` when Security Guard exits the vehicle
      vehicle.stages.push({
        stageName: actualStageName,
        role,
        eventType: "End",
        timestamp: new Date(),
        outKM: role === "Security Guard" ? outKM : null,
        outDriver: role === "Security Guard" ? outDriver : null,
      });

      // ✅ Update exitTime **ONLY** if Security Guard marks "End"
      if (role === "Security Guard" && stageName === "Security Gate") {
        vehicle.exitTime = new Date();
      }

      await vehicle.save();
      return res.status(200).json({ success: true, message: `${actualStageName} completed.`, vehicle });
    }

    console.log(`❌ Invalid event type received for ${formattedVehicleNumber}`);
    return res.status(400).json({ success: false, message: "Invalid event type." });

  } catch (error) {
    console.error("❌ Error in /vehicle-check:", error);
    return res.status(500).json({ success: false, message: "Server error", error });
  }
});


router.get("/vehicles/bay-allocation-started", async (req, res) => {
  try {
    const vehicles = await Vehicle.find({
      "stages.stageName": "Bay Allocation Started",
      "stages.eventType": "Start",
    }).sort({ entryTime: -1 });

    if (vehicles.length === 0) {
      return res.status(404).json({ success: false, message: "No vehicles with Bay Allocation Started found." });
    }

    res.status(200).json({ success: true, vehicles });
  } catch (error) {
    console.error("❌ Error in GET /vehicles/bay-allocation-started:", error);
    res.status(500).json({ success: false, message: "Server error", error });
  }
});

// ✅ Fetch Bay Work In-Progress & Completed
router.get("/vehicles/PMbay-work-in-progress", async (req, res) => {
  try {
    // ✅ Fetch all vehicles with Bay Work stages
    const vehicles = await Vehicle.find({ "stages.stageName": { $regex: /^Bay Work:/ } });

    const inProgressVehicles = [];
    const finishedVehicles = [];

    vehicles.forEach((vehicle) => {
      const bayWorkStages = vehicle.stages.filter(stage => stage.stageName.startsWith("Bay Work:"));
      
      // ✅ Group by Work Type
      const workTypeGroups = {};
      bayWorkStages.forEach(stage => {
        const workType = stage.workType || "Unknown";
        if (!workTypeGroups[workType]) {
          workTypeGroups[workType] = [];
        }
        workTypeGroups[workType].push(stage);
      });

      // ✅ Check for In-Progress or Completed Work
      for (const [workType, stages] of Object.entries(workTypeGroups)) {
        const lastStart = stages.findLast(stage => stage.eventType === "Start");
        const lastEnd = stages.findLast(stage => stage.eventType === "End");

        if (lastStart && (!lastEnd || new Date(lastStart.timestamp) > new Date(lastEnd.timestamp))) {
          inProgressVehicles.push({
            vehicleNumber: vehicle.vehicleNumber,
            workType,
            bayNumber: lastStart.bayNumber,
            timestamp: lastStart.timestamp,
            _id: vehicle._id,
          });
        } else if (lastStart && lastEnd) {
          finishedVehicles.push({
            vehicleNumber: vehicle.vehicleNumber,
            workType,
            bayNumber: lastStart.bayNumber,
            timestamp: lastEnd.timestamp,
            _id: vehicle._id,
          });
        }
      }
    });

    res.status(200).json({ success: true, inProgressVehicles, finishedVehicles });
  } catch (error) {
    console.error("❌ Error in /vehicles/bay-work-in-progress:", error);
    res.status(500).json({ success: false, message: "Server error", error });
  }
});




// ✅ 2️⃣ GET: Fetch All Vehicles & Their Full Journey
router.get("/vehicles", async (req, res) => {
  try {
    const vehicles = await Vehicle.find().sort({ entryTime: -1 });

    if (vehicles.length === 0) {
      return res.status(404).json({ success: false, message: "No vehicles found." });
    }

    return res.status(200).json({ success: true, vehicles });
  } catch (error) {
    console.error("❌ Error in GET /vehicles:", error);
    res.status(500).json({ success: false, message: "Server error", error });
  }
});

// ✅ 3️⃣ GET: Fetch Single Vehicle Journey by Vehicle Number
router.get("/vehicles/:vehicleNumber", async (req, res) => {
  try {
    const { vehicleNumber } = req.params;
    const formattedVehicleNumber = vehicleNumber.trim().toUpperCase();

    const vehicle = await Vehicle.findOne({ vehicleNumber: formattedVehicleNumber }).sort({ entryTime: -1 });

    if (!vehicle) {
      return res.status(404).json({ success: false, message: "Vehicle not found." });
    }

    return res.status(200).json({ success: true, vehicle });
  } catch (error) {
    console.error("❌ Error in GET /vehicles/:vehicleNumber:", error);
    res.status(500).json({ success: false, message: "Server error", error });
  }
});

// ✅ Get vehicles with bay allocation in progress
router.get("/vehicles/bay-allocation-in-progress", async (req, res) => {
  try {
    const vehicles = await Vehicle.find({
      "stages.stageName": "Bay Allocation Started",
    });

    return res.json({ success: true, vehicles });
  } catch (error) {
    console.error("Error fetching vehicles in progress:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ✅ Get vehicles that have completed Interactive Bay work
router.get("/finished-interactive-bay", async (req, res) => {
  try {
    const vehicles = await Vehicle.find().sort({ entryTime: -1 });

    // Filter vehicles that have both "Start" and "End" for "Interactive Bay"
    const filteredVehicles = vehicles.filter(vehicle => {
      const interactiveBayStages = vehicle.stages.filter(stage =>
        stage.stageName === "Interactive Bay" || stage.stageName.startsWith("Bay Work:"));

      const hasStart = interactiveBayStages.some(stage => stage.eventType === "Start");
      const hasEnd = interactiveBayStages.some(stage => stage.eventType === "End");

      return hasStart && hasEnd; // Return only if both Start and End exist
    });

    if (filteredVehicles.length === 0) {
      return res.status(404).json({ success: false, message: "No vehicles found with completed Interactive Bay." });
    }

    return res.status(200).json({ success: true, vehicles: filteredVehicles });
  } catch (error) {
    console.error("❌ Error in GET /finished-interactive-bay:", error);
    res.status(500).json({ success: false, message: "Server error", error });
  }
});

// ✅ Get vehicles with Interactive Bay work started
router.get("/vehicles/interactive-started", async (req, res) => {
  try {
    console.log("➡️ Fetching Interactive Bay Started Vehicles...");

    // Modified to find vehicles with Interactive Bay work or any Bay Work stages
    const vehicles = await Vehicle.find({
      $or: [
        { "stages.stageName": "Interactive Bay", "stages.eventType": "Start" },
        { "stages.stageName": { $regex: "Bay Work:", $options: "i" }, "stages.eventType": "Start" }
      ]
    });

    console.log("✅ Found Vehicles:", vehicles);

    if (vehicles.length === 0) {
      console.log("❌ No matching vehicles found");
      return res.status(404).json({
        success: false,
        message: "Vehicle not found.",
        existingVehicles: await Vehicle.find().select("vehicleNumber stages.stageName stages.eventType"), // Slimmed down for clarity
      });
    }

    res.json({ success: true, vehicles });
  } catch (error) {
    console.error("❌ Error fetching started Interactive Bay vehicles:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching started Interactive Bay vehicles",
      error: error.message
    });
  }
});

// ✅ Get all bay work in progress
router.get("/vehicles/bay-work-in-progress", async (req, res) => {
  try {
    const vehicles = await Vehicle.find().sort({ entryTime: -1 });

    // Filter vehicles that have bay work started but not completed
    const filteredVehicles = vehicles.filter(vehicle => {
      // Get all bay-related stages
      const bayStages = vehicle.stages.filter(stage =>
        stage.stageName === "Bay Allocation Started" ||
        stage.stageName === "Interactive Bay" ||
        stage.stageName.startsWith("Bay Work:"));

      // Group stages by their specific name
      const stageGroups = {};
      bayStages.forEach(stage => {
        if (!stageGroups[stage.stageName]) {
          stageGroups[stage.stageName] = [];
        }
        stageGroups[stage.stageName].push(stage);
      });

      // Check if any stage group has a Start without a matching End
      let hasIncompleteWork = false;
      Object.values(stageGroups).forEach(group => {
        const starts = group.filter(s => s.eventType === "Start").length;
        const ends = group.filter(s => s.eventType === "End").length;
        if (starts > ends) {
          hasIncompleteWork = true;
        }
      });

      return hasIncompleteWork;
    });

    return res.status(200).json({ success: true, vehicles: filteredVehicles });
  } catch (error) {
    console.error("❌ Error in GET /vehicles/bay-work-in-progress:", error);
    res.status(500).json({ success: false, message: "Server error", error });
  }
});

// ✅ 4️⃣ DELETE: Remove All Vehicles (For Testing/Resetting Data)
router.delete("/vehicles", async (req, res) => {
  try {
    await Vehicle.deleteMany();
    return res.status(200).json({ success: true, message: "All vehicle records deleted." });
  } catch (error) {
    console.error("❌ Error in DELETE /vehicles:", error);
    res.status(500).json({ success: false, message: "Server error", error });
  }
});

module.exports = router;