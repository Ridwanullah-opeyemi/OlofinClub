// Add this route to your backend routes file:
router.get("/loans/pending", verifyToken, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("loan_requests")
      .select("*")
      .eq("status", "pending");
      
    if (error) throw error;
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});