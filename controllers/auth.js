import supabase from "../config/db.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { sendSystemEmail } from "./mailController.js";
import crypto from "crypto";

// @desc    Register a new user (Admin function)
// @route   POST /api/auth/register
// @access  Private/Admin
export const registerUser = async (req, res) => {
  try {
    const { username, email, password, phone, role } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required details: username, email, and password.",
      });
    }

    const sanitizedEmail = email.trim().toLowerCase();

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const { data, error } = await supabase
      .from("users")
      .insert([
        {
          username,
          email: sanitizedEmail,
          password: hashedPassword, 
          phone: phone || null,
          amount_paid: 0,
          is_verified: false,
          role: role || "member", 
        },
      ])
      .select(); 

    if (error) {
      if (error.code === "23505") { 
        return res.status(400).json({
          success: false,
          message: "A user with this email already exists.",
        });
      }
      throw error;
    }

    const secureUserData = { ...data[0] };
    delete secureUserData.password;

    return res.status(201).json({
      success: true,
      message: "User account created successfully by Admin.",
      data: secureUserData, 
    });

  } catch (error) {
    console.error("Registration Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error during registration.",
      error: error.message,
    });
  }
};

// @desc    Authenticate user, verify password, and issue secure JWT Token
// @route   POST /api/auth/login
// @access  Public
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide both email and password parameters.",
      });
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("email", email.trim().toLowerCase())
      .single();

    if (error || !user) {
      return res.status(401).json({
        success: false,
        message: "Invalid login credentials provided. (User not found)",
      });
    }

    // Compare incoming string password with DB hash string
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid login credentials provided. (Password mismatch)",
      });
    }

    // ⚙️ FIXED FALLBACK LOGIC: Safely evaluate role values
    let determinedRoleTier = user.role_tier || user.role || "member";
    let determinedFounderStatus = user.is_primary_founder || false;

    if (user.role === "admin" || determinedRoleTier === "admin") {
      determinedRoleTier = "main_admin";
      determinedFounderStatus = true;
    }

    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        username: user.username,
        role_tier: determinedRoleTier,         
        is_primary_founder: determinedFounderStatus 
      },
      process.env.JWT_SECRET,
      { expiresIn: "24h" } 
    );

    return res.status(200).json({
      success: true,
      message: "Authentication successful.",
      token, 
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        is_verified: user.is_verified,
        role_tier: determinedRoleTier,         
        is_primary_founder: determinedFounderStatus 
      },
    });

  } catch (error) {
    console.error("Secure Login System Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error during login processing.",
    });
  }
};

// @desc    Initiate password reset process by generating verification token
// @route   POST /api/auth/forgot-password
// @access  Public
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: "Please provide your email address." });
    }

    const sanitizedEmail = email.trim().toLowerCase();

    const { data: user, error: fetchErr } = await supabase
      .from("users")
      .select("id, username, email")
      .eq("email", sanitizedEmail)
      .single();

    if (fetchErr || !user) {
      return res.status(200).json({ 
        success: true, 
        message: "If an account matches that email address, a password reset link has been dispatched." 
      });
    }

    const resetToken = crypto.randomBytes(32).toString("hex");
    const tokenExpiryTime = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    const { error: updateErr } = await supabase
      .from("users")
      .update({
        reset_password_token: resetToken,
        reset_password_expires: tokenExpiryTime
      })
      .eq("id", user.id);

    if (updateErr) throw updateErr;

    const passwordResetLink = `http://localhost:3000/reset-password/${resetToken}`;

    const forgotEmailTemplate = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #2c3e50; text-align: center;">🔒 Account Password Reset Request</h2>
        <p>Hello <strong>${user.username}</strong>,</p>
        <p>We received a formal request to reset the password associated with your Olofin Heritage Club portal profile.</p>
        <p>To safely choose a new security password credentials layer, click the verification button link displayed below:</p>
        <div style="margin: 25px 0; text-align: center;">
          <a href="${passwordResetLink}" style="background-color: #e67e22; color: white; padding: 12px 25px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Reset My Password</a>
        </div>
        <p style="color: #e74c3c; font-size: 13px;"><strong>⚠️ Security warning notice:</strong> This link is strictly configured to expire automatically after 15 minutes. If you did not issue this security alteration request, please ignore this email or notify an administrator immediately.</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin-top: 25px;" />
        <p style="font-size: 11px; color: #95a5a6; text-align: center;">Olofin Heritage Club Systems Security Engine © 2026</p>
      </div>
    `;

    await sendSystemEmail(user.email, "Olofin Heritage Club - Secure Password Reset Link 🔒", forgotEmailTemplate);

    return res.status(200).json({ 
      success: true, 
      message: "If an account matches that email address, a password reset link has been dispatched." 
    });

  } catch (error) {
    console.error("Forgot Password system failure:", error);
    return res.status(500).json({ success: false, message: "Server encountered error routing password recovery request." });
  }
};

// @desc    Verify validation token and change user account password 
// @route   PUT /api/auth/reset-password/:token
// @access  Public
export const resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: "Please provide a valid new password string at least 6 characters long." });
    }

    const currentTimeStamp = new Date().toISOString();

    const { data: user, error: fetchErr } = await supabase
      .from("users")
      .select("id, username")
      .eq("reset_password_token", token)
      .gt("reset_password_expires", currentTimeStamp) 
      .single();

    if (fetchErr || !user) {
      return res.status(400).json({ 
        success: false, 
        message: "Your password recovery authorization link is invalid or has expired. Please request a new token link." 
      });
    }

    const salt = await bcrypt.genSalt(10);
    const encryptedNewPassword = await bcrypt.hash(newPassword, salt);

    const { error: updateErr } = await supabase
      .from("users")
      .update({
        password: encryptedNewPassword,
        reset_password_token: null,       
        reset_password_expires: null
      })
      .eq("id", user.id);

    if (updateErr) throw updateErr;

    return res.status(200).json({ 
      success: true, 
      message: "Success! Your profile password has been successfully re-encrypted. You can now securely log into the dashboard application." 
    });

  } catch (error) {
    console.error("Reset Password system failure:", error);
    return res.status(500).json({ success: false, message: "Internal server update process crash." });
  }
};

// @desc    Get all users data (Admin function)
// @route   GET /api/auth/users
// @access  Private/Admin
export const getAllUsers = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .order("id", { ascending: true }); 

    if (error) throw error;

    return res.status(200).json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    console.error("Get All Users Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching system users.",
      error: error.message,
    });
  }
};

// @desc    Delete a specific user account (Admin function)
// @route   DELETE /api/auth/users/:id
// @access  Private/Admin
export const deleteUser = async (req, res) => {
  try {
    const { id } = req.params; 
    const adminExecutingDeletion = req.user?.id; 

    if (String(id) === String(adminExecutingDeletion)) {
      return res.status(403).json({
        success: false,
        message: "Operation Denied: You cannot execute a deletion command against your own active administrative session.",
      });
    }

    const { data: existingUser, error: findError } = await supabase
      .from("users")
      .select("id, username")
      .eq("id", id)
      .single();

    if (findError || !existingUser) {
      return res.status(404).json({
        success: false,
        message: "Target user account not found.",
      });
    }

    const { error: deleteError } = await supabase
      .from("users")
      .delete()
      .eq("id", id);

    if (deleteError) throw deleteError;

    return res.status(200).json({
      success: true,
      message: `User '${existingUser.username}' has been successfully removed from the platform.`,
    });

  } catch (error) {
    console.error("Delete User Controller Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error occurred during account removal.",
      error: error.message,
    });
  }
};

// @desc    Credit a user account (Admin function - Add Money)
// @route   PUT /api/auth/users/:id/credit
// @access  Private/Admin
export const creditUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, description } = req.body;

    if (amount === undefined || isNaN(amount) || Number(amount) <= 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid numeric credit amount greater than zero.",
      });
    }

    const creditAmount = Number(amount);

    const { data: user, error: findError } = await supabase
      .from("users")
      .select("id, amount_paid")
      .eq("id", id)
      .single();

    if (findError || !user) {
      return res.status(404).json({ success: false, message: "User account not found." });
    }

    const previousBalance = Number(user.amount_paid);
    const newBalance = previousBalance + creditAmount; 

    const { data: updatedUser, error: updateError } = await supabase
      .from("users")
      .update({ amount_paid: newBalance })
      .eq("id", id)
      .select();

    if (updateError) throw updateError;

    await supabase.from("transactions").insert([
      {
        user_id: id,
        amount_changed: creditAmount, 
        previous_balance: previousBalance,
        new_balance: newBalance,
        description: description || "Admin credited contribution account.",
      },
    ]);

    return res.status(200).json({
      success: true,
      message: `Successfully credited ${creditAmount}. Balance updated from ${previousBalance} to ${newBalance}.`,
      user: updatedUser[0],
    });
  } catch (error) {
    console.error("Credit Controller Error:", error);
    return res.status(500).json({ success: false, message: "Server error during credit operation." });
  }
};

// @desc    Debit a user account (Admin function - Remove/Deduct Money)
// @route   PUT /api/auth/users/:id/debit
// @access  Private/Admin
export const debitUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, description } = req.body;

    if (amount === undefined || isNaN(amount) || Number(amount) <= 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid numeric debit amount greater than zero.",
      });
    }

    const debitAmount = Number(amount);

    const { data: user, error: findError } = await supabase
      .from("users")
      .select("id, amount_paid")
      .eq("id", id)
      .single();

    if (findError || !user) {
      return res.status(404).json({ success: false, message: "User account not found." });
    }

    const previousBalance = Number(user.amount_paid);

    if (previousBalance - debitAmount < 0) {
      return res.status(400).json({
        success: false,
        message: `Insufficient funds. User only has ${previousBalance}, cannot deduct ${debitAmount}.`,
      });
    }

    const newBalance = previousBalance - debitAmount; 

    const { data: updatedUser, error: updateError } = await supabase
      .from("users")
      .update({ amount_paid: newBalance })
      .eq("id", id)
      .select();

    if (updateError) throw updateError;

    await supabase.from("transactions").insert([
      {
        user_id: id,
        amount_changed: -debitAmount, 
        previous_balance: previousBalance,
        new_balance: newBalance,
        description: description || "Admin debited contribution account.",
      },
    ]);

    return res.status(200).json({
      success: true,
      message: `Successfully debited ${debitAmount}. Balance updated from ${previousBalance} to ${newBalance}.`,
      user: updatedUser[0],
    });
  } catch (error) {
    console.error("Debit Controller Error:", error);
    return res.status(500).json({ success: false, message: "Server error during debit operation." });
  }
};

// @desc    Get complete system transaction logs 
// @route   GET /api/auth/transactions
// @access  Private/Admin
export const getAllTransactions = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("transactions")
      .select(`
        id,
        created_at,
        amount_changed,
        previous_balance,
        new_balance,
        description,
        users ( id, username, email )
      `)
      .order("created_at", { ascending: false }); 

    if (error) throw error;

    return res.status(200).json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Could not fetch platform transaction records.",
      error: error.message,
    });
  }
};

// @desc    Submit a deposit request with proof of payment (Member function)
// @route   POST /api/user/deposit-request
// @access  Private/Member
export const createDepositRequest = async (req, res) => {
  try {
    const { amount, proof_url } = req.body;
    const { id: user_id, username } = req.user; 

    if (!amount || !proof_url) {
      return res.status(400).json({ success: false, message: "Please provide amount and proof of payment." });
    }

    const { data, error } = await supabase
      .from("deposits")
      .insert([{ user_id, username, amount: Number(amount), proof_url, status: "pending" }])
      .select();

    if (error) throw error;

    return res.status(201).json({ success: true, message: "Deposit request submitted successfully!", data: data[0] });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Approve a pending deposit request, credit user, and log historical transaction entries
// @route   PATCH /api/auth/deposits/:id/approve
// @access  Private/Admin
export const approveDepositRequest = async (req, res) => {
  try {
    const { id } = req.params;

    const { data: deposit, error: fetchError } = await supabase
      .from("deposits")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !deposit) {
      return res.status(404).json({ success: false, message: "Deposit request not found." });
    }

    if (deposit.status === "approved") {
      return res.status(400).json({ success: false, message: "This transaction deposit log has already been approved." });
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("amount_paid, email")
      .eq("id", deposit.user_id)
      .single();

    if (userError || !user) {
      return res.status(404).json({ success: false, message: "Associated transaction member profile record missing." });
    }

    const previousBalance = Number(user.amount_paid || 0); 
    const depositAmount = Number(deposit.amount);
    const newComputedBalance = previousBalance + depositAmount;

    const { error: updateDepositError } = await supabase
      .from("deposits")
      .update({ status: "approved" })
      .eq("id", id);

    if (updateDepositError) throw updateDepositError;

    const { error: updateUserError } = await supabase
      .from("users")
      .update({ amount_paid: newComputedBalance })
      .eq("id", deposit.user_id);

    if (updateUserError) throw updateUserError;

    const { error: logTransactionError } = await supabase
      .from("transactions")
      .insert({
        user_id: deposit.user_id,
        amount_changed: depositAmount,
        previous_balance: previousBalance, 
        new_balance: newComputedBalance,
        description: `Approved Deposit Receipt Log - Ref #${id}`
      });

    if (logTransactionError) {
      console.error("Supabase Insertion Error:", logTransactionError);
      throw logTransactionError;
    }

    // 👍 FIXED: Email template logic moved BEFORE response return block so it sends successfully
    const depositEmailTemplate = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h3 style="color: #2498db;">💳 Payment Deposit Verified</h3>
        <p>Hello,</p>
        <p>Your deposit tracking voucher has been processed and verified successfully by the administration panel.</p>
        <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
          <tr style="background: #f8f9fa;"><td style="padding: 8px; font-weight: bold;">Amount Loaded:</td><td style="padding: 8px; color: #2ecc71; font-weight: bold;">₦${depositAmount.toLocaleString()}</td></tr>
          <tr><td style="padding: 8px; font-weight: bold;">Transaction Status:</td><td style="padding: 8px; color: #2ecc71;">Credited to Savings Pool</td></tr>
        </table>
        <p>Thank you for your consistent participation inside the collective portfolio workspace!</p>
      </div>
    `;
    
    // Safely send out the transaction email
    if (user.email) {
      await sendSystemEmail(user.email, "Financial Ledger Update: Deposit Cleared ✅", depositEmailTemplate);
    }

    return res.status(200).json({
      success: true,
      message: "Deposit parameters verified, balance scaled, and transaction audit logs recorded cleanly!",
    });

  } catch (error) {
    console.error("Deposit approval system error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error during deposit execution.",
      error: error.message
    });
  }
};

// @desc    Update member profile parameters (Username / Password)
// @route   PUT /api/user/update-profile
// @access  Private/Member
export const updateProfile = async (req, res) => {
  try {
    const { username, password } = req.body;
    const userId = req.user.id; 

    if (!username) {
      return res.status(400).json({ success: false, message: "Username parameter cannot be blank." });
    }

    const updateData = { username: username.trim() };

    if (password && password.trim() !== "") {
      if (password.length < 6) {
        return res.status(400).json({ success: false, message: "Password must be at least 6 characters long." });
      }
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(password, salt);
    }

    const { data, error } = await supabase
      .from("users")
      .update(updateData)
      .eq("id", userId)
      .select("id, username, email, role")
      .single();

    if (error) throw error;

    return res.status(200).json({
      success: true,
      message: "Profile settings processed and updated successfully!",
      user: data
    });
  } catch (error) {
    console.error("Profile updates crash error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    Get all pending deposit requests for admin review
// @route   GET /api/auth/deposits/pending
// @access  Private/Admin
export const getPendingDeposits = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("deposits")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) throw error;

    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// @desc    End secure session
// @route   POST /api/auth/logout
// @access  Private 
export const logoutUser = async (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      message: "Session ended successfully on server."
    });
  } catch (error) {
    console.error("Logout System Error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error during logout processing."
    });
  }
};