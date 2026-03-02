/* ===============================
   UPDATE MAINTENANCE STATUS
   PUT /api/manager/maintenance/:id/status
================================ */
router.put(
  "/maintenance/:id/status",
  authenticateUser,
  enforceSafeMode,
  async (req, res) => {
    const { status: newStatus } = req.body;

    if (!newStatus) {
      return res.status(400).json({ error: "New status is required" });
    }

    const allowedTransitions = {
      OPEN: ["IN_PROGRESS"],
      IN_PROGRESS: ["CLOSED"],
      CLOSED: [],
    };

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const managerDbId = await getManagerDbId(req.user.id);
      if (!managerDbId) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Manager not found" });
      }

      // 🔐 Get manager's residency
      const residencyResult = await client.query(
        `
        SELECT residency_id
        FROM manager_residencies
        WHERE manager_id = $1
        LIMIT 1;
        `,
        [managerDbId]
      );

      if (residencyResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "No residency access" });
      }

      const managerResidencyId = residencyResult.rows[0].residency_id;

      // 🔎 Fetch existing maintenance request
      const maintenanceResult = await client.query(
        `
        SELECT id, status, residency_id
        FROM maintenance_requests
        WHERE id = $1
        LIMIT 1;
        `,
        [req.params.id]
      );

      if (maintenanceResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: "Maintenance request not found" });
      }

      const maintenance = maintenanceResult.rows[0];

      // 🔒 Residency isolation check
      if (maintenance.residency_id !== managerResidencyId) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: "Forbidden" });
      }

      const currentStatus = maintenance.status;

      // 🔒 Validate allowed transition
      if (!allowedTransitions[currentStatus]?.includes(newStatus)) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: `Invalid status transition: ${currentStatus} → ${newStatus}`,
        });
      }

      // ✅ Perform safe update
      await client.query(
        `
        UPDATE maintenance_requests
        SET status = $1,
            updated_at = NOW()
        WHERE id = $2;
        `,
        [newStatus, req.params.id]
      );

      await client.query("COMMIT");

      res.json({ success: true });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Update maintenance status error:", error);
      res.status(500).json({ error: "Failed to update status" });
    } finally {
      client.release();
    }
  }
);