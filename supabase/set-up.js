import dotenv from 'dotenv'
import { createClient} from '@supabase/supabase-js'
dotenv.config(); 
const supabaseurl=process.env.SUPA_BASE_URL;
const supabasekey=process.env.SUPA_BASE_KEY;
export const supabase_connect=createClient(supabaseurl,supabasekey);



