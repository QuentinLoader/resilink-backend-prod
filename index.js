import express from "express";
import cors from "cors";
import { enforceSafeMode } from "./middleware/safeMode.js";
import publicRoutes from "./routes/public.js";
import managerRoutes from "./routes/manager.js";
import managerMaintenanceRoutes from "./routes/manager.maintenance.js";
import whatsappRoutes from "./routes/whatsapp.js";

const app = express();

app.use(cors());
app.use(express.json());
app.use("/api/whatsapp", whatsappRoutes);

// Health & root first (never blocked)
app.get("/api/health", (_, res) => {
  res.json({ status: "OK" });
});

app.get("/", (_, res) => {
  res.send("ResiLink API OK");
});

// 🔒 Safe Mode applies to all API routes below
app.use(enforceSafeMode);

// Mount routes
app.use("/api/public", publicRoutes);
app.use("/api/manager", managerMaintenanceRoutes);
app.use("/api/manager", managerRoutes);

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`ResiLink API running on port ${port}`);
});