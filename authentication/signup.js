import dotenv from "dotenv"
import express from "express"
import bcrypt from 'bcrypt'
import { supabase_connect } from "../supabase/set-up.js"
import jsonwebtoken from 'jsonwebtoken';
const router=express.Router();
  const jsonpassword=process.env.JSONWEBPASSWORD
router.post('',async(req,res)=>{
const {user_name,user_email,user_password}=req.body;
const {data:existingUsers}=await supabase_connect
.from("users_account_details")
.select('*')
.eq('user_email',user_email)
.single()
if(existingUsers){
   return  res.json({message:`User Already exists! ${existingUsers.user_email}` })
}
const hashedPassword=await bcrypt.hash(user_password,10);
const {data,error}=await supabase_connect
.from("users_account_details")
.insert([{
    user_email:user_email,
    user_password:hashedPassword,
    user_name:user_name
}])
const {data:existingUser}=await supabase_connect
.from("users_account_details")
.select('*')
.eq('user_email',user_email)
.single()
if(existingUser){
   const unique_id=existingUser.unique_id
 const playload={id:unique_id}
const AccessToken=jsonwebtoken.sign(playload,jsonpassword,{expiresIn:'2d'})
const RefreshToken =jsonwebtoken.sign(playload,jsonpassword,{expiresIn:'7d'})
res.cookie('ac_token',AccessToken,{
    httpOnly:false,
    secure:false,
    maxAge:1000*60*60*24*2,
    sameSite:'lax',
})
res.cookie('rf_token',RefreshToken,{
    httpOnly:true,
    secure:false,
    maxAge:1000*60*60*24*7,
    sameSite:'lax'
})
}
if(error){
    // Update it later to res.json null
    console.log(`unable to insert into the supabase ${error.message} `)
}else{
res.json({message:"Account created  sucessfully",success:true})
}

})
export default router
