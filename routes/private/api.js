const { isEmpty } = require("lodash");
const { v4 } = require("uuid");
const db = require("../../connectors/db");
const roles = require("../../constants/roles");
const {getSessionToken}=require('../../utils/session')
const getUser = async function (req) {
  const sessionToken = getSessionToken(req);
  if (!sessionToken) {
    return res.status(301).redirect("/");
  }
  console.log("hi",sessionToken);
  const user = await db
    .select("*")
    .from("se_project.sessions")
    .where("token", sessionToken)
    .innerJoin(
      "se_project.users",
      "se_project.sessions.userid",
      "se_project.users.id"
    )
    .innerJoin(
      "se_project.roles",
      "se_project.users.roleid",
      "se_project.roles.id"
    )
   .first();

  console.log("user =>", user);
  user.isNormal = user.roleid === roles.user;
  user.isAdmin = user.roleid === roles.admin;
  user.isSenior = user.roleid === roles.senior;
  console.log("user =>", user)
  return user;
};

const getPrice = async function(startStation, endStation){
  return 100;
}

module.exports = function (app) {
  // example
  app.get("/users", async function (req, res) {
    try {
       const user = await getUser(req);
      const users = await db.select('*').from("se_project.users")
        
      return res.status(200).json(users);
    } catch (e) {
      console.log(e.message);
      return res.status(400).send("Could not get users");
    }
   
  });
 
  app.get("/api/v1/tickets/price", async function (req, res) {
    const {startStation, endStation} = req;

    const station1 = await db
      .select("*")
      .from("se_project.stations")
      .where("id", startStation);
    const station2 = await db
      .select("*")
      .from("se_project.stations")
      .where("id", endStation);

    if(!station1){
      return res.status(404).send("start station does not exist");
    }else if(!station2){
      return res.status(404).send("end station does not exist");
    }
    

    try{
      const price = await getPrice(startStation, endStation);
      console.log(price);
      return res.status(200);
    }catch(e){
      console.log(e.message);
      return res.status(400).send("Could not get price");
    }
    
  })

  
};
