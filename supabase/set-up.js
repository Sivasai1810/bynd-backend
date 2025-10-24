import dotenv from 'dotenv'
import { createClient} from '@supabase/supabase-js'
dotenv.config(); 
const supabaseurl=process.env.SUPA_BASE_URL;
// const supabasekey=process.env.SUPA_BASE_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabase_connect=createClient(supabaseurl,supabaseServiceKey,{
    auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});



