import supabase from "../config/db.js"; // Default module instance
import { sendSystemEmail } from "./mailController.js"; // Email dispatcher component

// ==========================================================================
// 👤 USER-INITIATED PIPELINE ACTIONS
// ==========================================================================

// @desc    Submit a new loan request (User Action)
export const requestLoan = async (req, res) => {
  try {
    const { amount, purpose } = req.body;
    const userId = req.user.id;

    const { data: user } = await supabase.from("users").select("username").eq("id", userId).single();

    const { error } = await supabase
      .from("loan_requests")
      .insert([{ user_id: userId, username: user.username, amount_requested: Number(amount), purpose, status: "pending" }]);

    if (error) throw error;
    return res.status(200).json({ success: true, message: "Loan application submitted to the pipeline." });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Submit proof of paying back a portion/all of a loan (User Action)
export const submitLoanRepayment = async (req, res) => {
  try {
    const { amount, reference_proof } = req.body;
    const userId = req.user.id;

    const { data: user } = await supabase.from("users").select("username, loan_balance").eq("id", userId).single();

    if ((user.loan_balance || 0) <= 0) {
      return res.status(400).json({ success: false, message: "You do not have any active outstanding loan balances to pay back." });
    }

    const { error } = await supabase
      .from("loan_repayments")
      .insert([
        { 
          user_id: userId, 
          username: user.username, 
          amount_paid: Number(amount), 
          reference_proof, 
          status: "pending" 
        }
      ]);

    if (error) throw error;
    return res.status(200).json({ success: true, message: "Repayment submission recorded. Pending management audit verification." });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// ==========================================================================
// ⚙️ ADMINISTRATIVE APPROVAL & DISBURSEMENT CHANNELS
// ==========================================================================

// @desc    Get all pending loan applications (Admin Action)
export const getPendingLoanRequests = async (req, res) => {
  try {
    const { data, error } = await supabase.from("loan_requests").select("*").eq("status", "pending");
    if (error) throw error;
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Get all pending repayments (Admin Action)
export const getPendingRepayments = async (req, res) => {
  try {
    const { data, error } = await supabase.from("loan_repayments").select("*").eq("status", "pending");
    if (error) throw error;
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Approve Loan Request -> Updates Balances & Logs to Unified Transaction Table
export const resolveLoanRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const { action } = req.body; // "approved" or "declined"

    // 🎯 Join lookup to instantly fetch the associated user's profile email address safely
    const { data: loan } = await supabase
      .from("loan_requests")
      .select("*, users(email, username)")
      .eq("id", requestId)
      .single();

    if (!loan || loan.status !== "pending") {
      return res.status(400).json({ success: false, message: "Request already processed or missing." });
    }

    if (action === "approved") {
      const { data: user } = await supabase.from("users").select("amount_paid, loan_balance").eq("id", loan.user_id).single();

      const oldMainBalance = user.amount_paid || 0;
      const newMainBalance = oldMainBalance + loan.amount_requested; 
      const newLoanBalance = (user.loan_balance || 0) + loan.amount_requested; 

      // 1. Update target user fields
      await supabase.from("users").update({ amount_paid: newMainBalance, loan_balance: newLoanBalance }).eq("id", loan.user_id);

      // 📜 2. Log Statement to Transactions History Table Ledger
      await supabase.from("transactions").insert([
        {
          user_id: loan.user_id,
          amount_changed: loan.amount_requested, 
          previous_balance: oldMainBalance,
          new_balance: newMainBalance,
          description: `💰 Loan Capital Disbursed - Ref: #LOAN-${loan.id}`
        }
      ]);

      // ✉️ 3. Send Olofin Heritage Club Disbursement Email Confirmation Notice
      const userEmailAddress = loan.users?.email;
      if (userEmailAddress) {
        const loanEmailTemplate = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
            <h3 style="color: #e67e22; margin-top: 0;">💸 Capital Loan Disbursed</h3>
            <p>Hello <strong>${loan.users?.username || "Member"}</strong>,</p>
            <p>Your application requesting credit financing assistance has been formally <strong>approved</strong> by the club administrators.</p>
            <div style="background-color: #fdf7f2; padding: 15px; border-left: 4px solid #e67e22; margin: 15px 0;">
              <strong>Principal Amount Issued:</strong> ₦${loan.amount_requested.toLocaleString()}<br/>
              <strong>Status:</strong> Active Debt Profile Registered
            </div>
            <p>⚠️ <em>Please note that your monthly contributions or dynamic dashboard payments will now be subject to debt clearance metrics until this facility balance returns to ₦0.</em></p>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
            <p style="font-size: 11px; color: #95a5a6; text-align: center;">Olofin Heritage Club © 2026</p>
          </div>
        `;
        await sendSystemEmail(userEmailAddress, "Loan Request Disbursed Successfully 💸", loanEmailTemplate);
      }
    }

    await supabase.from("loan_requests").update({ status: action }).eq("id", requestId);
    return res.status(200).json({ success: true, message: `Loan marked as ${action}.` });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Approve Loan Repayment -> Deducts Debt, Deducts Wallet, Logs to Unified Transaction Table
export const resolveLoanRepayment = async (req, res) => {
  try {
    const { repaymentId } = req.params;
    const { action } = req.body; 

    const { data: repayment } = await supabase
      .from("loan_repayments")
      .select("*, users(email, username)")
      .eq("id", repaymentId)
      .single();

    if (!repayment || repayment.status !== "pending") {
      return res.status(400).json({ success: false, message: "Repayment entry processed or missing." });
    }

    if (action === "approved") {
      const { data: user } = await supabase.from("users").select("amount_paid, loan_balance").eq("id", repayment.user_id).single();

      const oldMainBalance = user.amount_paid || 0;
      const newLoanBalance = Math.max(0, (user.loan_balance || 0) - repayment.amount_paid); 
      const newMainBalance = Math.max(0, oldMainBalance - repayment.amount_paid); 

      // 1. Update database user record fields 
      await supabase.from("users").update({ amount_paid: newMainBalance, loan_balance: newLoanBalance }).eq("id", repayment.user_id);

      // 📜 2. Log audit tracking transaction
      await supabase.from("transactions").insert([
        {
          user_id: repayment.user_id,
          amount_changed: -repayment.amount_paid, 
          previous_balance: oldMainBalance,
          new_balance: newMainBalance,
          description: `💳 Loan Settlement Repayment Verified - Ref: #REPAY-${repayment.id}`
        }
      ]);

      // ✉️ 3. Dispatch Clear Receipt Email to Member
      const userEmailAddress = repayment.users?.email;
      if (userEmailAddress) {
        const repaymentTemplate = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
            <h3 style="color: #2ecc71; margin-top: 0;">✅ Loan Repayment Approved</h3>
            <p>Hello <strong>${repayment.users?.username || "Member"}</strong>,</p>
            <p>Your submission proof for loan settlement has been successfully reviewed and verified by management.</p>
            <div style="background-color: #f2fbf5; padding: 15px; border-left: 4px solid #2ecc71; margin: 15px 0;">
              <strong>Amount Received & Cleared:</strong> ₦${repayment.amount_paid.toLocaleString()}<br/>
              <strong>Remaining Loan Balance:</strong> ₦${newLoanBalance.toLocaleString()}
            </div>
            <p>Thank you for fulfilling your organizational lending facility obligations promptly!</p>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
            <p style="font-size: 11px; color: #95a5a6; text-align: center;">Olofin Heritage Club © 2026</p>
          </div>
        `;
        await sendSystemEmail(userEmailAddress, "Loan Repayment Confirmed ✅", repaymentTemplate);
      }
    }

    await supabase.from("loan_repayments").update({ status: action }).eq("id", repaymentId);
    return res.status(200).json({ success: true, message: `Repayment marked as ${action}.` });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Direct Admin Manual Dashboard Repayment Overrides
export const handleDirectAdminRepayment = async (req, res) => {
  const userId = req.params.id;
  const { amount } = req.body;

  if (!amount || Number(amount) <= 0) {
    return res.status(400).json({ success: false, message: "Please enter a valid repayment amount greater than 0." });
  }

  try {
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("id, username, loan_balance, amount_paid")
      .eq("id", userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({ success: false, message: "User account not found." });
    }

    const currentLoanDebt = Number(user.loan_balance) || 0;
    const oldMainBalance = Number(user.amount_paid) || 0;

    if (Number(amount) > currentLoanDebt) {
      return res.status(400).json({ 
        success: false, 
        message: `Repayment amount exceeds debt! ${user.username} only owes ₦${currentLoanDebt.toLocaleString()}.` 
      });
    }

    const newLoanBalance = currentLoanDebt - Number(amount);

    // Update main database user row fields directly
    const { error: updateError } = await supabase
      .from("users")
      .update({ loan_balance: newLoanBalance })
      .eq("id", userId);

    if (updateError) throw updateError;

    // Unified Normalized Transactions Ledger Log Integration alignment
    await supabase.from("transactions").insert([
      { 
        user_id: userId, 
        amount_changed: -Number(amount),
        previous_balance: oldMainBalance,
        new_balance: oldMainBalance, // Wallet structural balance remains unchanged for manual admin reduction overrides
        description: "Direct manual loan balance deduction applied by Admin."
      }
    ]);

    // ✉️ Dispatch Direct Adjustment Email Notification Note to User
    if (user.email) {
      const manualAdjustTemplate = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
          <h3 style="color: #9b59b6; margin-top: 0;">🛠️ Loan Balance Adjusted</h3>
          <p>Hello <strong>${user.username}</strong>,</p>
          <p>An administrator has manually applied a direct balance adjustment correction to your lending account ledger profile details.</p>
          <div style="background-color: #faf4fc; padding: 15px; border-left: 4px solid #9b59b6; margin: 15px 0;">
            <strong>Deduction Credit Processed:</strong> ₦${Number(amount).toLocaleString()}<br/>
            <strong>Updated Debt Balance Remaining:</strong> ₦${newLoanBalance.toLocaleString()}
          </div>
          <p>Please contact the Olofin Heritage Club administrative helpdesk if you believe this transaction entry is an accounting error.</p>
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="font-size: 11px; color: #95a5a6; text-align: center;">Olofin Heritage Club © 2026</p>
        </div>
      `;
      await sendSystemEmail(user.email, "Account Profile Loan Balance Correction Notice 🔔", manualAdjustTemplate);
    }

    return res.status(200).json({ 
      success: true, 
      message: `Successfully deducted ₦${Number(amount).toLocaleString()} from ${user.username}'s loan! Remaining debt: ₦${newLoanBalance.toLocaleString()}.`
    });

  } catch (err) {
    console.error("Supabase admin repayment system fault:", err);
    return res.status(500).json({ success: false, message: "Server runtime transactional ledger failure." });
  }
};