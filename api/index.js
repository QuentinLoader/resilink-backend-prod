import express from "express";
import publicRoutes from "./routes/public.js";

const app = express();
app.use(express.json());

app.get("/health", (_, res) => res.send("OK"));

app.use("/public", publicRoutes);

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`ResiLink API running on ${port}`);
});
