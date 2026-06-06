
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

    // 1. Basic Validation
    if (!username || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required details: username, email, and password.",
      });
    }

    // Sanitize input data
    const sanitizedEmail = email.trim().toLowerCase();

    // 2. Securely Hash the Password using bcrypt
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 3. Insert into your Supabase 'users' table
    const { data, error } = await supabase
      .from("users")
      .insert([
        {
          username,
          email: sanitizedEmail,
          password: hashedPassword, // 🔥 Saved safely as an encrypted hash string!
          phone: phone || null,
          amount_paid: 0,
          is_verified: false,
          role: role || "member", // Defaults to 'member' if admin doesn't specify 'admin'
        },
      ])
      .select(); // Returns the newly created record details

    // 4. Handle database insertion errors (like duplicate emails)
    if (error) {
      if (error.code === "23505") { // PostgreSQL code for unique constraint violation
        return res.status(400).json({
          success: false,
          message: "A user with this email already exists.",
        });
      }
      throw error;
    }

    // Strip out the hashed password from the response data so it stays completely secret
    const secureUserData = { ...data[0] };
    delete secureUserData.password;

    // 5. Return complete success response
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

    // 1. Basic validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide both email and password parameters.",
      });
    }

    // 2. Fetch the user profile data from Supabase
    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("email", email.trim().toLowerCase())
      .single();

    if (error || !user) {
      return res.status(401).json({
        success: false,
        message: "Invalid login credentials provided.",
      });
    }

    // 3. Compare passwords using bcrypt
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid login credentials provided.",
      });
    }

    // ⚙️ FALLBACK LOGIC: Safely maps old database records to the new role hierarchy seamlessly
    let determinedRoleTier = user.role_tier;
    let determinedFounderStatus = user.is_primary_founder || false;

    if (!determinedRoleTier) {
      if (user.role === "admin") {
        determinedRoleTier = "main_admin";
        determinedFounderStatus = true;
      } else {
        determinedRoleTier = "member";
      }
    }

    // 4. Generate the secure JWT token payload using updated hierarchical properties
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        username: user.username,
        role_tier: determinedRoleTier,         // 🔥 Updated: New security role parameter
        is_primary_founder: determinedFounderStatus // 🔥 Updated: New protective flag parameter
      },
      process.env.JWT_SECRET,
      { expiresIn: "24h" } 
    );

    // 5. Send token and user parameters back to client interface
    return res.status(200).json({
      success: true,
      message: "Authentication successful.",
      token, 
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        is_verified: user.is_verified,
        role_tier: determinedRoleTier,         // 🔥 Updated: Frontend state tree now reads this
        is_primary_founder: determinedFounderStatus // 🔥 Updated: Customizes administrative dashboard access
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

    // 1. Check if the user profile exists inside Olofin Heritage Club directory
    const { data: user, error: fetchErr } = await supabase
      .from("users")
      .select("id, username, email")
      .eq("email", sanitizedEmail)
      .single();

    // Safety: For security reasons, don't explicitly confirm if an email doesn't exist 
    // to protect your database from email enumeration hackers.
    if (fetchErr || !user) {
      return res.status(200).json({ 
        success: true, 
        message: "If an account matches that email address, a password reset link has been dispatched." 
      });
    }

    // 2. Generate a secure, unguessable random token string
    const resetToken = crypto.randomBytes(32).toString("hex");
    
    // Set validation window to expire strictly after 15 minutes
    const tokenExpiryTime = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    // 3. Save the token and expiry date right into the user row
    const { error: updateErr } = await supabase
      .from("users")
      .update({
        reset_password_token: resetToken,
        reset_password_expires: tokenExpiryTime
      })
      .eq("id", user.id);

    if (updateErr) throw updateErr;

    // 4. Construct the reset verification URL link
    // Change localhost to your real domain when you deploy!
    const passwordResetLink = `http://localhost:3000/reset-password/${resetToken}`;

    // 🎯 5. Send Professional Password Reset Email Template
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

    // 1. Query table to find the matching token AND ensure the expiry timestamp hasn't passed
    const { data: user, error: fetchErr } = await supabase
      .from("users")
      .select("id, username")
      .eq("reset_password_token", token)
      .gt("reset_password_expires", currentTimeStamp) // Checks if column expiration value > right now
      .single();

    if (fetchErr || !user) {
      return res.status(400).json({ 
        success: false, 
        message: "Your password recovery authorization link is invalid or has expired. Please request a new token link." 
      });
    }

    // 2. Hash the fresh incoming password safely
    const salt = await bcrypt.genSalt(10);
    const encryptedNewPassword = await bcrypt.hash(newPassword, salt);

    // 3. Clear out token fields and record the brand-new password string hash
    const { error: updateErr } = await supabase
      .from("users")
      .update({
        password: encryptedNewPassword,
        reset_password_token: null,       // Wipe token completely so it can't be used twice!
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
    // Fetch all records from the 'users' table
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .order("id", { ascending: true }); // Groups them neatly by order of creation

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
    const { id } = req.params; // Grabs the user's ID directly from the URL path
    const adminExecutingDeletion = req.user?.id; // Safely extracts logged-in admin ID from your auth middleware

    // 🔥 1. SHIELD CHECK FIRST: Prevent self-destructive lockout operations instantly
    if (String(id) === String(adminExecutingDeletion)) {
      return res.status(403).json({
        success: false,
        message: "Operation Denied: You cannot execute a deletion command against your own active administrative session.",
      });
    }

    // 🔍 2. EXISTENCE CHECK: Verify the target profile exists in the pool
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

    // 🗑️ 3. EXECUTION: Perform the permanent cascade deletion
    const { error: deleteError } = await supabase
      .from("users")
      .delete()
      .eq("id", id);

    if (deleteError) throw deleteError;

    // 🎉 SUCCESS RESPONSE
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

    // 1. Validation
    if (amount === undefined || isNaN(amount) || Number(amount) <= 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid numeric credit amount greater than zero.",
      });
    }

    const creditAmount = Number(amount);

    // 2. Fetch current balance
    const { data: user, error: findError } = await supabase
      .from("users")
      .select("id, amount_paid")
      .eq("id", id)
      .single();

    if (findError || !user) {
      return res.status(404).json({ success: false, message: "User account not found." });
    }

    const previousBalance = Number(user.amount_paid);
    const newBalance = previousBalance + creditAmount; // 🟢 ADDING FUNDS

    // 3. Update User Balance
    const { data: updatedUser, error: updateError } = await supabase
      .from("users")
      .update({ amount_paid: newBalance })
      .eq("id", id)
      .select();

    if (updateError) throw updateError;

    // 4. Log to Transactions Table
    await supabase.from("transactions").insert([
      {
        user_id: id,
        amount_changed: creditAmount, // Positive number shows it was a credit
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

    // 1. Validation
    if (amount === undefined || isNaN(amount) || Number(amount) <= 0) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid numeric debit amount greater than zero.",
      });
    }

    const debitAmount = Number(amount);

    // 2. Fetch current balance
    const { data: user, error: findError } = await supabase
      .from("users")
      .select("id, amount_paid")
      .eq("id", id)
      .single();

    if (findError || !user) {
      return res.status(404).json({ success: false, message: "User account not found." });
    }

    const previousBalance = Number(user.amount_paid);

    // 🛑 Critical Check: Prevent account balances from dropping into negative numbers
    if (previousBalance - debitAmount < 0) {
      return res.status(400).json({
        success: false,
        message: `Insufficient funds. User only has ${previousBalance}, cannot deduct ${debitAmount}.`,
      });
    }

    const newBalance = previousBalance - debitAmount; // 🔴 SUBTRACTING FUNDS

    // 3. Update User Balance
    const { data: updatedUser, error: updateError } = await supabase
      .from("users")
      .update({ amount_paid: newBalance })
      .eq("id", id)
      .select();

    if (updateError) throw updateError;

    // 4. Log to Transactions Table
    await supabase.from("transactions").insert([
      {
        user_id: id,
        amount_changed: -debitAmount, // Save as a negative number to indicate a deduction!
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
      .order("created_at", { ascending: false }); // Newest changes appear first

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
    const { id: user_id, username } = req.user; // Pulled from your verified JWT token

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

    // 1. Fetch the original pending deposit request data
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

    // 2. Fetch the target user's current record details
    const { data: user, error: userError } = await supabase
      .from("users")
      .select("amount_paid")
      .eq("id", deposit.user_id)
      .single();

    if (userError || !user) {
      return res.status(404).json({ success: false, message: "Associated transaction member profile record missing." });
    }

    // 🔥 PRECISE BALANCE CALCULATIONS BASED ON YOUR SQL FIELDS
    const previousBalance = Number(user.amount_paid || 0); // This is what we needed!
    const depositAmount = Number(deposit.amount);
    const newComputedBalance = previousBalance + depositAmount;

    // 3. Perform the safe sequential atomic database updates:
    
    // A. Mark deposit status index as approved
    const { error: updateDepositError } = await supabase
      .from("deposits")
      .update({ status: "approved" })
      .eq("id", id);

    if (updateDepositError) throw updateDepositError;

    // B. Inject credit value additions straight into the member profile's core balance
    const { error: updateUserError } = await supabase
      .from("users")
      .update({ amount_paid: newComputedBalance })
      .eq("id", deposit.user_id);

    if (updateUserError) throw updateUserError;

    // 🔥 C. FIXED: Inserting all mandatory schema parameters into your public.transactions table
    const { error: logTransactionError } = await supabase
      .from("transactions")
      .insert({
        user_id: deposit.user_id,
        amount_changed: depositAmount,
        previous_balance: previousBalance, // Added to clear the NOT NULL constraint!
        new_balance: newComputedBalance,
        description: `Approved Deposit Receipt Log - Ref #${id}`
      });

    if (logTransactionError) {
      console.error("Supabase Insertion Error:", logTransactionError);
      throw logTransactionError;
    }

    return res.status(200).json({
      success: true,
      message: "Deposit parameters verified, balance scaled, and transaction audit logs recorded cleanly!",
    });

    // Inside approveDepositRequest controller...
if (depositIsApproved) {
  const depositEmailTemplate = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
      <h3 style="color: #2498db;">💳 Payment Deposit Verified</h3>
      <p>Hello,</p>
      <p>Your deposit tracking voucher has been processed and verified successfully by the administration panel.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
        <tr style="background: #f8f9fa;"><td style="padding: 8px; font-weight: bold;">Amount Loaded:</td><td style="padding: 8px; color: #2ecc71; font-weight: bold;">₦${amount.toLocaleString()}</td></tr>
        <tr><td style="padding: 8px; font-weight: bold;">Transaction Status:</td><td style="padding: 8px; color: #2ecc71;">Credited to Savings Pool</td></tr>
      </table>
      <p>Thank you for your consistent participation inside the collective portfolio workspace!</p>
    </div>
  `;
  await sendSystemEmail(userEmailAddress, "Financial Ledger Update: Deposit Cleared ✅", depositEmailTemplate);
}

  } catch (error) {
    console.error("Deposit approval system error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error during deposit execution.",
      error: error.message
    });
  }
};
// @route   POST /api/auth/logout
// @access  Private (Requires token verification)
export const logoutUser = async (req, res) => {
  try {
    // If you ever expand your app to use HTTP-Only Cookies, we clear them here:
    // res.clearCookie('token');

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


// @desc    Update member profile parameters (Username / Password)
// @route   PUT /api/user/update-profile
// @access  Private/Member
export const updateProfile = async (req, res) => {
  try {
    const { username, password } = req.body;
    const userId = req.user.id; // Pulled straight from your verified JWT middleware payload

    if (!username) {
      return res.status(400).json({ success: false, message: "Username parameter cannot be blank." });
    }

    // 1. Build out the update map data template dynamically
    const updateData = { username: username.trim() };

    // 2. If user provided a password string text, hash it securely before saving
    if (password && password.trim() !== "") {
      if (password.length < 6) {
        return res.status(400).json({ success: false, message: "Password must be at least 6 characters long." });
      }
      const salt = await bcrypt.genSalt(10);
      updateData.password = await bcrypt.hash(password, salt);
    }

    // 3. Update data within Supabase user relation row
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