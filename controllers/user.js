import supabase from "../config/db.js";

// @desc    Get logged-in user's private dashboard profile (Balance, Info & Active Loans)
// @route   GET /api/user/:id/profile
// @access  Private/User Own Data
export const getUserProfile = async (req, res) => {
  try {
    const { id } = req.params;

    // 🎯 FIXED: Selecting all original profile details AND adding loan_balance explicitly
    const { data: user, error } = await supabase
      .from("users")
      .select("id, username, email, phone, amount_paid, loan_balance, is_verified, role")
      .eq("id", id)
      .single();

    if (error || !user) {
      return res.status(404).json({
        success: false,
        message: "Profile record not found.",
      });
    }

    return res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error retrieving profile.",
      error: error.message,
    });
  }
};

// @desc    Get logged-in user's private transaction history ledger
// @route   GET /api/user/:id/transactions
// @access  Private/User Own Data
export const getUserTransactions = async (req, res) => {
  try {
    const { id } = req.params;

    // Query transactions that match this user's ID only
    const { data: transactions, error } = await supabase
      .from("transactions")
      .select("id, created_at, amount_changed, previous_balance, new_balance, description")
      .eq("user_id", id)
      .order("created_at", { ascending: false }); // Newest transactions first

    if (error) throw error;

    return res.status(200).json({
      success: true,
      count: transactions.length,
      data: transactions,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error fetching transaction ledger.",
      error: error.message,
    });
  }
};