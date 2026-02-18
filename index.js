import express from "express";
import publicRoutes from "./routes/public.js";
import managerRoutes from "./routes/manager.js";

const app = express();
app.use(express.json());

// Health check
app.get("/health", (_, res) => res.json({ status: "OK" }));

// Mount routes
app.use("/api/public", publicRoutes);
app.use("/api/manager", managerRoutes);

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`ResiLink API running on port ${port}`);
});
