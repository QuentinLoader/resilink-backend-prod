import express from "express";
import cors from "cors";
import publicRoutes from "./routes/public.js";
import managerRoutes from "./routes/manager.js";

const app = express();

app.use(cors());
app.use(express.json());

// Health check
app.get("/api/health", (_, res) => {
  res.json({ status: "OK" });
});

app.get("/", (_, res) => {
  res.send("ResiLink API OK");
});

// Mount routes
app.use("/api/public", publicRoutes);
app.use("/api/manager", managerRoutes);

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`ResiLink API running on port ${port}`);
});
