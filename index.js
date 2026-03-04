import express from "express";
import cors from "cors";

import { enforceSafeMode } from "./middleware/safeMode.js";

import publicRoutes from "./routes/public.js";
import managerRoutes from "./routes/manager.js";
import managerMaintenanceRoutes from "./routes/manager.maintenance.js";
import residentRoutes from "./routes/resident.js";
import residentMaintenanceRoutes from "./routes/resident.maintenance.js";
import whatsappRoutes from "./routes/whatsapp.js";

const app = express();

/* =========================================
   Core Middleware
========================================= */

app.use(cors());
app.use(express.json());

/* =========================================
   Health & Root (never blocked)
========================================= */

app.get("/api/health", (_, res) => {
  res.json({ status: "OK" });
});

app.get("/", (_, res) => {
  res.send("ResiLink API OK");
});

/* =========================================
   WhatsApp Webhook
========================================= */

app.use("/api/whatsapp", whatsappRoutes);

/* =========================================
   Safe Mode Protection
========================================= */

app.use(enforceSafeMode);

/* =========================================
   Public Routes
========================================= */

app.use("/api/public", publicRoutes);

/* =========================================
   Resident Portal
========================================= */

app.use("/api/resident", residentRoutes);
app.use("/api/resident/maintenance", residentMaintenanceRoutes);

/* =========================================
   Manager Dashboard
========================================= */

app.use("/api/manager", managerRoutes);
app.use("/api/manager", managerMaintenanceRoutes);

/* =========================================
   Start Server
========================================= */

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`ResiLink API running on port ${port}`);
});