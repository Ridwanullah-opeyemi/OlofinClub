import supabase from "../config/db.js";

// @desc    Send a message to the group chat
// @route   POST /api/chat/message
// @access  Private/Authenticated User
export const sendMessage = async (req, res) => {
  try {
    const { message_text } = req.body;
    
    // req.user is supplied directly from our verifyUser middleware file!
    const senderId = req.user.id; 

    // 1. Validation
    if (!message_text || message_text.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Cannot transmit blank message payloads.",
      });
    }

    // 2. Fetch sender profile details to find their display username
    const { data: profile, error: profileError } = await supabase
      .from("users")
      .select("username")
      .eq("id", senderId)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({
        success: false,
        message: "Sender mapping context failed.",
      });
    }

    // 3. Write message directly to the table row layout
    const { data: newMessage, error: insertError } = await supabase
      .from("group_messages")
      .insert([
        {
          sender_id: senderId,
          sender_name: profile.username,
          message_text: message_text.trim(),
        },
      ])
      .select();

    if (insertError) throw insertError;

    return res.status(201).json({
      success: true,
      message: "Message processed successfully.",
      data: newMessage[0],
    });

  } catch (error) {
    console.error("Chat Dispatch Error:", error);
    return res.status(500).json({
      success: false,
      message: "Could not send community broadcast.",
      error: error.message,
    });
  }
};

// @desc    Fetch message stream text history logs
// @route   GET /api/chat/messages
// @access  Private/Authenticated User
export const getChatHistory = async (req, res) => {
  try {
    // Grab the last 50 entries so users don't pull heavy bulk assets at once
    const { data: logs, error } = await supabase
      .from("group_messages")
      .select("id, created_at, sender_id, sender_name, message_text")
      .order("created_at", { ascending: true })
      .limit(50);

    if (error) throw error;

    return res.status(200).json({
      success: true,
      count: logs.length,
      data: logs,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Could not sync history database streams.",
      error: error.message,
    });
  }
};