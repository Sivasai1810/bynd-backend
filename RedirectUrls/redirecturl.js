import express from 'express'
import { supabase_connect } from "../supabase/set-up.js";
const router=express.Router();
router.get('',async(req,res)=>{
const {data,error}=await supabase_connect.auth.getSessionFromUrl();
if(error){
    res.json({message:"unable to login with goole"})
}else{
    console.log(data.session);
}
})
export default router