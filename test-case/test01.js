import express from "express"
import verifyToken from "../middlewares/verifytoken.js"
const router=express.Router()
router.post('',verifyToken,(req,res)=>{
    try{
        res.json({message:`Token verify successfully ${req.user}`})
    }catch(err){
        console.log("unable to verify",err)
    }
})
export default router
