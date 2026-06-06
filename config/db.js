import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

// Call this immediately before anything else runs in this file
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

// 1. Initialize the client
const supabase = createClient(supabaseUrl, supabaseSecretKey);

// 2. Immediate connection health check
async function testConnection() {
  console.log("connecting to db...");
  
  try {
    // Note: Querying an actual table like 'users' avoids metadata permission errors
    const { data, error } = await supabase.from('users').select('id').limit(1);
    
    if (error) {
      throw error;
    }
    
    console.log("🚀 Supabase connected successfully!");
  } catch (err) {
    console.error("❌ Supabase connection failed:");
    console.error(err.message || err);
  }
}

// Run the check
testConnection();

export default supabase;