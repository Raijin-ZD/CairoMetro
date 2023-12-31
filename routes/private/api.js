const { isEmpty } = require("lodash");
const { v4 } = require("uuid");
const db = require("../../connectors/db");
const roles = require("../../constants/roles");
const { getSessionToken } = require('../../utils/session');
const getUser = async function (req) {
  const sessionToken = getSessionToken(req);
  if (!sessionToken) {
    return res.status(301).redirect("/");
  }

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
  return user;
};

//Helper method for checkPrice endpoint api
//gets price based on shortest distance from originStation to destinationStation
const getPrice = async function (startStation = 1, endStation = 2) {
  var visited = [];
  var queue = [];
  queue.push({ station: parseInt(startStation), distance: 0 });

  let curr = queue.shift();
  for (let i = 0; curr != undefined; i++) {
    visited.push(curr);

    const neighbours = await db
      .select("tostationid")
      .from("se_project.routes")
      .where("fromstationid", curr.station);

    for (let j = 0; j < neighbours.length; j++) {
      var flag = false;
      const station = neighbours[j].tostationid;

      for (let k = 0; k < visited.length; k++) {
        const visitedStation = visited[k];
        if (parseInt(station) == parseInt(visitedStation.station)) {
          flag = true;
        }
      }

      if (flag) {
        continue;
      }
      queue.push({ station: station, distance: curr.distance + 1 });
    }
    curr = queue.shift();
  }

  var distance = 0;
  for (let i = 0; i < visited.length; i++) {
    if (parseInt(endStation) == visited[i].station) {
      distance = visited[i].distance;
      break;
    }
  }

  const zones = await db
    .select("*")
    .from("se_project.zones")
    .orderBy("price");

  const length = zones.length;
  if (length == 0) {
    return -1;
  }

  for (let i = 0; i < length; i++) {
    try {
      if (distance < parseInt(zones[i].zonetype)) {
        return zones[i].price;
      }
    } catch (e) {
      return zones[length - 1].price;
    }
  }
}

//Helper method for ticket payments endpoint
//gets the transfer stations passed during trip from originStation to destinationStation
const getTransferStations = async function (startStation = 1, endStation = 2) {
  var visited = [];
  var stack = [];
  var transfer = [];

  stack.push(parseInt(startStation));

  let curr = stack.pop();
  let isFirst = true;
  let flag = false;
  while (curr != undefined) {
    flag = false;
    for (let k = 0; k < visited.length; k++) {

      const visitedStation = visited[k];
      if (parseInt(curr) == parseInt(visitedStation)) {
        flag = true;
      }
    } if (flag) {
      curr = stack.pop();
      continue;
    }

    while (transfer.length > 0 && transfer[0].length > stack.length) {
      console.log(stack.length);
      transfer.shift();
    }

    const isTransfer = await db
      .select("stationtype")
      .from("se_project.stations")
      .where("id", curr)
      .first();

    if (isTransfer.stationtype == "transfer" && !isFirst) {
      const name = await db.select("stationname").from("se_project.stations").where("id", curr).first();
      transfer.push({ station: name.stationname, length: stack.length });
    }

    visited.push(curr);

    const neighbours = await db
      .select("tostationid")
      .from("se_project.routes")
      .where("fromstationid", curr);

    for (let j = 0; j < neighbours.length; j++) {
      flag = false;
      const station = neighbours[j].tostationid;

      for (let k = 0; k < visited.length; k++) {
        const visitedStation = visited[k];
        if (parseInt(station) == parseInt(visitedStation)) {
          flag = true;
        }
      }

      if (flag) {
        continue;
      }

      if (station == endStation) {
        return transfer;
      }

      stack.push(station);
    }
    curr = stack.pop();
    isFirst = false;
  }

  return null;
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

  //checkPrice endpoint
  app.get("/api/v1/tickets/price", async function (req, res) {
    const originName = req.query.originId;
    const destinationName = req.query.destinationId;

    const station1 = await db
      .select("*")
      .from("se_project.stations")
      .where("stationname", originName);
    const station2 = await db
      .select("*")
      .from("se_project.stations")
      .where("stationname", destinationName);

    if (!station1) {
      return res.status(404).send("start station does not exist");
    } if (!station2) {
      return res.status(404).send("end station does not exist");
    }

    const originId = await db
    .select("id")
    .from("se_project.stations")
    .where("stationname", originName)
    .first();
    const destinationId = await db
    .select("id")
    .from("se_project.stations")
    .where("stationname", destinationName)
    .first();

    try {
      const price = await getPrice(originId.id, destinationId.id);
      if (price < 0) {
        return res.status(400).send("missing zone data");
      }
      return res.status(200).send(""+ price);
    } catch (e) {
      console.log(e.message);
      return res.status(400).send("Could not get price");
    }

  });

  app.put("/api/v1/ride/simulate", async function (req, res) {
    const origin = req.body.origin;
    const destination = req.body.destination;
    const date = new Date(req.body.tripDate);
    const tripDate = date.toISOString();
    const user = await getUser(req);
    const userID = user.userid;

    const rideExists = await db
      .select("*")
      .from("se_project.rides")
      .where("origin", origin)
      .andWhere("destination", destination)
      .andWhere("tripdate", tripDate)
      .andWhere("userid", userID);

    if (isEmpty(rideExists)) {
      return res.status(404).send("trip doesn't exist");
    }

    try {
      await db("se_project.rides")
        .where("origin", origin)
        .andWhere("destination", destination)
        .andWhere("tripdate", tripDate)
        .andWhere("userid", userID)
        .update({
          status: "Completed"
        })
        .returning("*");

      return res.status(200).send("ride simulated successfully");
    } catch (e) {
      return res.status(404).send("couldn't simulate ride");
    }
  });
  //Resettting password endpoint

  app.put("/api/v1/password/reset", async function (req, res) {
    const User = await getUser(req);
    const email = User.email;
    const { newPassword } = req.body;

    if (!newPassword) {
      // If the password is not present, return an HTTP unauthorized code
      return res.status(400).send("New Password is required");
    }

    // Get the user's ID from the database.
    const user = await db
      .select("*")
      .from("se_project.users")
      .where("email", email)
      .first();

    if (!user) {
      // If the user does not exist, return an HTTP not found code.
      return res.status(404).send("User does not exist");
    }
    try {
      await db("se_project.users")
        .where("email", email)
        .update({
          password: newPassword
        })
        .returning("*");
      res.status(200).send("Password reset successfully");
    } catch (error) {
      console.error(error.stack);
      return false;
    }

  });

  //Creating a new station
  app.post("/api/v1/station", async function (req, res) {
    const { stationName } = req.body;
    // Check if the station name is already taken.
    const existingStation = await db
      .select("*")
      .from("se_project.stations")
      .where("stationname", stationName)
      .first();
    if (existingStation) {
      // If the station name is already taken, return an HTTP conflict code.
      return res.status(409).send("Station name already taken");
    }
    // Create a new station 
    const newStation = {
      stationname: stationName,
      stationtype: "normal",
      stationstatus: "new",
    };

    //await Station.insertOrIgnore(newStation);
    //await db.insert("se_project.stations", newStation);
    try {
      await db("se_project.stations").insert(newStation).returning("*");
      res.status(201).send("Station created successfully");
      //return res.status(200).json(station );
    } catch (e) {
      console.log(e.message);
      return res.status(400).send("Could not add new station");
    }
    // Return a success message.
    //res.status(201).send("Station created successfully");
  });
  //Updating a station
  app.put("/api/v1/station/:stationId", async function (req, res) {
    //request parameters are , which are the values that are passed to the endpoint after the slash
    const { stationId } = req.params;// access the request parameters
    //const { stationName } = req.body;
    const newStationName = req.body.stationName;

    // Check if the station exists.
    const existingStation = await db
      .select("*")
      .from("se_project.stations")
      .where("id", stationId)
      .first();

    if (!existingStation) {
      // If the station does not exist, return an HTTP not found code.
      return res.status(404).send("Station does not exist");
    }
    try {
      await db("se_project.stations")
        .where("id", stationId)
        .update({
          stationname: newStationName
        })
        .returning("*");
      // Return a success message.
      res.status(200).send("Station updated successfully");

    }
    catch (e) {
      console.log(e.message);
      res.status(400).json({ error: "Unable to update station name.", });
    }
  });

  app.delete("/api/v1/station/:stationId", async function (req, res) {
    // Get the station ID from the request.
    const { stationId: stationId } = req.params;
    // Check if the station exists.
    const existingStation = await db
      .select("*")
      .from("se_project.stations")
      .where("id", stationId)
      .first();

    if (!existingStation) {
      // If the station does not exist, return an HTTP not found code.
      return res.status(404).send("Station does not exist");
    }
    //console.log(existingStation.stationtype);
    //console.log(existingStation.stationposition);
    const pos = existingStation.stationposition;
    // console.log(pos);
    if (existingStation.stationtype == "transfer") {
      //keda keda middle station
      //station to make transfer
      //console.log("meow");
      const newtransfer = await db
        .select("*")
        .from("se_project.routes")
        .where("tostationid", stationId)
        .first();
      const newtransferid = newtransfer.fromstationid;
      //console.log(newtransferid);
      const type = "transfer";
      //make it transfer
      await db("se_project.stations")
        .where("id", newtransferid)
        .update({
          stationtype: type
        })
        .returning("*");
      //get the new transfer postition  to make sure it is middle station
      const newtpos = await db
        .select("*")
        .from("se_project.stations")
        .where("id", newtransferid)
        .first();
      const newtranferpos = newtpos.stationposition;
      position = "middle";
      //make it middle station
      if (newtranferpos != "middle") {
        await db("se_project.stations")
          .where("id", newtransferid)
          .update({
            stationposition: position
          })
      }
      //make new routes 
      const all = await db
        .select("*")
        .from("se_project.routes")
        .where("fromstationid", stationId);
      for (let i = 0; i < all.length; i++) {
        if (newtransferid != all[i].tostationid) {
          //create a new raye7 route
          const nRoute = {
            routename: "new",
            fromstationid: newtransferid,
            tostationid: all[i].tostationid,
          };
          //create a new ra8e3 route
          const newRoute = {
            routename: "new",
            fromstationid: all[i].tostationid,
            tostationid: newtransferid,
          };

          //insert the new routes
          await db("se_project.routes").insert(nRoute).returning("*");
          await db("se_project.routes").insert(newRoute).returning("*");
          //get route id
          const routeid = await db
            .select("*")
            .from("se_project.routes")
            .where("tostationid", all[i].tostationid)
            .andWhere("routename", "new");
          len = routeid.length - 1;
          const rid = await db
            .select("*")
            .from("se_project.routes")
            .where("fromstationid", all[i].tostationid)
            .andWhere("routename", "new");
          len2 = rid.length - 1;
          //create new stationroutes
          const stationroute = {
            stationid: newtransferid,
            routeid: routeid[len].id,
          };
          const sr = {
            stationid: all[i].tostationid,
            routeid: routeid[len].id,
          };
          const stationro = {
            stationid: newtransferid,
            routeid: rid[len2].id,
          };
          const ss = {
            stationid: all[i].tostationid,
            routeid: rid[len2].id,
          };
          //insert the new station route
          await db("se_project.stationroutes").insert(stationroute).returning("*");
          await db("se_project.stationroutes").insert(sr).returning("*");
          await db("se_project.stationroutes").insert(stationro).returning("*");
          await db("se_project.stationroutes").insert(ss).returning("*");

        }
      }
    }
    else if (existingStation.stationtype != "transfer") {
      // get station's poisition
      //end case
      if (pos == "end") {
        //console.log("akked msh da");
        //getting the previous station
        const previd = await db
          .select("*")
          .from("se_project.routes")
          .where("tostationid", stationId)
          .first();
        //getting the position of the previous station
        const prevtype = await db
          .select("*")
          .from("se_project.stations")
          .where("id", previd.fromstationid)
          .first();
        // check if the previous  station is middle
        if (prevtype.stationposition == "middle") {
          //make it our new end station
          await db("se_project.stations")
            .where("id", previd.fromstationid)
            .update({
              stationposition: "end"
            })
            .returning("*");
        }
      }
      //deleting routes and stationroutes
      //done automatically with cascade delete
      //start case
      else if (pos == "start") {
        //get postion of next station
        //console.log("???",pos);
        const nextid = await db
          .select("*")
          .from("se_project.routes")
          .where("fromstationid", stationId)
          .first();
        //get the type of the next station
        const nexttype = await db
          .select("*")
          .from("se_project.stations")
          .where("id", nextid.tostationid)
          .first();
        // check if the next station is middle
        if (nexttype.stationposition == "middle") {
          //make it our new start station
          await db("se_project.stations")
            .where("id", nextid.tostationid)
            .update({
              stationposition: "start"
            })
            .returning("*");
        }
      }
      //deleting routes and stationroutes
      //done automatically with cascade delete
      //middle case
      else if (pos == "middle") {
        //previous station id
        const previd = await db
          .select("*")
          .from("se_project.routes")
          .where("tostationid", stationId)
          .first();
        // next station
        const nextid = await db
          .select("*")
          .from("se_project.routes")
          .where("fromstationid", stationId);
        //create a new ray7 route
        const newRoute = {
          routename: "new",
          fromstationid: previd.fromstationid,
          tostationid: nextid[1].tostationid,
        };
        //create a new rage3 route
        const nRoute = {
          routename: "new",
          fromstationid: nextid[1].tostationid,
          tostationid: previd.fromstationid,
        };
        //insert the new routes
        await db("se_project.routes").insert(newRoute).returning("*");
        await db("se_project.routes").insert(nRoute).returning("*");
        //get route id
        const routeid = await db
          .select("*")
          .from("se_project.routes")
          .where("fromstationid", nextid[1].tostationid)
          .andWhere("tostationid", previd.fromstationid)
          .andWhere("routename", "new");
        //get route id
        len = routeid.length - 1
        const rid = await db
          .select("*")
          .from("se_project.routes")
          .where("tostationid", nextid[1].tostationid)
          .andWhere("fromstationid", previd.fromstationid)
          .andWhere("routename", "new");
        len2 = rid.length - 1;
        const stationroute = {
          stationid: nextid[1].tostationid,
          routeid: routeid[len].id,
        };
        const sr = {
          stationid: previd.fromstationid,
          routeid: routeid[len].id,
        };
        const stationr = {
          stationid: nextid[1].tostationid,
          routeid: rid[len2].id,
        };
        const sroute = {
          stationid: previd.fromstationid,
          routeid: rid[len2].id,
        };
        //insert the new station route
        await db("se_project.stationroutes").insert(stationr).returning("*");
        await db("se_project.stationroutes").insert(sroute).returning("*");
        await db("se_project.stationroutes").insert(stationroute).returning("*");
        await db("se_project.stationroutes").insert(sr).returning("*");

      }
      //deleting routes and stationroutes
      //done automatically with delete cascade
    }
    // Delete the station from the database.
    await db("se_project.stations")
      .where("id", stationId)
      .delete();

    // Return a success message.
    res.status(200).send("Station deleted successfully");
  });

  app.post("/api/v1/senior/request", async function (req, res){
    try {
      const user = await getUser(req);
      const exists = await db.select("*").from("se_project.senior_requests").where("status", "pending").andWhere("userid", user.userid);
      if(!isEmpty(exists)){
        return res.status(400).send("you already have a request");
      }
      const NewSreq = {
        status: "pending",
        userid: user.userid,
        nationalid: req.body.nationalId
      };
      const Sreq = await db("se_project.senior_requests").insert(NewSreq).returning("*");
      return res.status(200).send(Sreq);

    }catch (e) {
      console.log(e.message);
      return res.status(400).send("Could not complete action");
    }
  });

  app.post("/api/v1/refund/:ticketId", async function (req, res) {

    try {
      const TId = req.params.ticketId;
      const start = await db.select('origin').from('se_project.tickets').where("id", TId);
      const end = await db.select('destination').from('se_project.tickets').where("id", TId);
      const startId = await db.select('id').from('se_project.stations').where("stationname", start);
      const endId = await db.select('id').from('se_project.stations').where("stationname", end);
      const amnt = await getPrice(startId.id, endId.id);
      const user = await getUser(req);

      const exists = await db.select("*").from("se_project.refund_requests").where("status", "pending").andWhere("ticketid", TId);
      if(!isEmpty(exists)){
        return res.status(400).send("you already have a request");
      }
      const NewRef = {
        status: "pending",
        userid: user.userid,
        refundamount: amnt,
        ticketid: TId,
      };
      const Ref = await db("se_project.refund_requests").insert(NewRef).returning("*");
      return res.status(200).json(Ref);

    } catch (e) {
      console.log(e.message);
      return res.status(400).send("Could not complete action");
    }
  });

  app.get("/api/v1/zones", async function (req, res) {
    try {
      const zones = await db.select('*').from('se_project.zones');
      return res.status(200).json(zones);

    } catch (e) {
      console.log(e.message);
      return res.status(400).send("Could not complete action");
    }
  });

  app.post("/api/v1/route", async function (req, res) {

    // Check if user already exists in the system
    //const routeName = req.body.routeName
    const fromStationId = req.body.fromStationId
    const toStationId = req.body.toStationId
    const routeExists = await db
      .select("*")
      .from("se_project.routes")
      .where("fromstationid", fromStationId).andWhere("tostationid", toStationId).first();
    //const fromStationId=req.body.new
    //const toStationId= routeExists.tostationid
    if (!isEmpty(routeExists)) {
      return res.status(400).send("route exists");
    }

    const newRoute = {
      fromstationid: fromStationId,
      tostationid: toStationId,
      routename: "NewFrom",
    };
    const newRoute1 = {
      fromstationid: toStationId,
      tostationid: fromStationId,
      routename: "NewTo",
    };
    
    try {
      const route = await db("se_project.routes").insert(newRoute).returning("*");
      const route1 = await db("se_project.routes").insert(newRoute1).returning("*");
       //create new stationroutes
       const stationroute = {
        stationid: toStationId,
        routeid: route1[0].id,
      };
      const sr = {
        stationid: toStationId,
        routeid: route[0].id,
      };
      const stationro = {
        stationid: toStationId,
        routeid: route[0].id,
      };
      const ss = {
        stationid: toStationId,
        routeid: route1[0].id,
      };
      //insert the new station route
      await db("se_project.stationroutes").insert(stationroute).returning("*");
      await db("se_project.stationroutes").insert(sr).returning("*");
      await db("se_project.stationroutes").insert(stationro).returning("*");
      await db("se_project.stationroutes").insert(ss).returning("*");

      await db("se_project.stations")
      .where("id", fromStationId)
      .update({
        stationstatus: "old"
      });
      await db("se_project.stations")
      .where("id", toStationId)
      .update({
        stationstatus: "old"
      });
  
      const routeToStationExistsInTo = await db
        .select("*")
        .from("se_project.routes")
        .where("tostationid", toStationId)
        .first();
      const routeFromStationExistsInFrom = await db
        .select("*")
        .from("se_project.routes")
        .where("fromstationid", fromStationId)
        .first();
      const routeToStationExistsInFrom = await db
        .select("*")
        .from("se_project.routes")
        .where("fromstationid", toStationId)
        .first();
      const routeFromStationExistsInTo = await db
        .select("*")
        .from("se_project.routes")
        .where("tostationid", fromStationId)
        .first();

      if (routeToStationExistsInFrom) {
        await db("se_project.stations")
          .where("id", toStationId)
          .update({
            stationposition: "start"
          });
      }
      else if (routeToStationExistsInTo) {
        await db("se_project.stations")
          .where("id", toStationId)
          .update({
            stationposition: "end"
          });
      }

      if (routeFromStationExistsInFrom) {
        await db("se_project.stations")
          .where("id", fromStationId)
          .update({
            stationposition: "start"
          });
      }
      else if (routeFromStationExistsInTo) {
        await db("se_project.stations")
          .where("id", fromStationId)
          .update({
            stationposition: "end"
          });
      }

      const countToFrom = await db
        .count("*")
        .from("se_project.routes").
        where("fromstationid", toStationId);

      const countFromFrom = await db
        .count("*")
        .from("se_project.routes").
        where("fromstationid", fromStationId);

      const countFromTo = await db
        .count("*")
        .from("se_project.routes").
        where("tostationid", fromStationId);

      const countToTo = await db
        .count("*")
        .from("se_project.routes").
        where("tostationid", toStationId);
      
      if ((countToFrom[0].count) >= 2 || (countToTo[0].count) >= 2) {
        await db("se_project.stations")
          .where("id", toStationId)
          .update({
            stationposition: "middle"
          });
      }
      if ((countFromTo[0].count) >= 2 || (countFromFrom[0].count) >= 2) {
        await db("se_project.stations")
          .where("id", fromStationId)
          .update({
            stationposition: "middle"
          });
      }
      if ((countToFrom[0].count) > 2 || (countToTo[0].count) > 2) {
        await db("se_project.stations")
          .where("id", toStationId)
          .update({
            stationtype: "transfer"
          });
      }
      if ((countFromTo[0].count) > 2 || (countFromFrom[0].count) > 2) {
        await db("se_project.stations")
          .where("id", fromStationId)
          .update({
            stationtype: "transfer"
          });
      }


      return res.status(200).json(route);
    } catch (e) {
      console.log(e.message);
      return res.status(400).send("Could not add route");
    }
  });

  app.put("/api/v1/route/:routeId", async function (req, res) {
    const { routeId } = req.params;// access the request parameters
    const routeName = req.body.routeName;
    const existingRoutes = await db
      .select("*")
      .from("se_project.routes")
      .where("id", routeId)
      .first();

    if (!existingRoutes) {
      return res.status(404).send("Routes does not exist");
    }
    try {
      await db("se_project.routes")
        .where("id", routeId)
        .update({
          routename: routeName,
        })
        .returning("*");
      // Return a success message.
      return res.status(200).send("Route updated successfully");

    }
    catch (e) {
      console.log(e.message);
      return res.status(400).json({ error: "Unable to update Route name.", });
    }
  });

  app.delete("/api/v1/route/:routeId", async function (req, res) {
    const { routeId: routeId } = req.params;
    const existingRoutes = await db
      .select("*")
      .from("se_project.routes")
      .where("id", routeId)
      .first();
    const fromStationId = existingRoutes.fromstationid
    const toStationId = existingRoutes.tostationid

    const existsmiddlefrom = await db .select("*") .from("se_project.stations").where("id" , fromStationId).first();
    const existsmiddleto = await db .select("*") .from("se_project.stations").where("id" , toStationId).first();

    if(existsmiddlefrom.stationposition == "middle" && existsmiddleto.stationposition == "middle"){
      return res.status(400).send("Route is middle");
    }
    if (!existingRoutes) {
      return res.status(404).send("Route does not exist");
    }
    await db("se_project.routes")
      .where("id", routeId)
      .delete();
    const existingBackwardRoute = await db
      .select("*")
      .from("se_project.routes")
      .where("fromstationid", toStationId).andWhere("tostationid", fromStationId)
      .first();
    const routeToStationExistsInTo = await db
      .select("*")
      .from("se_project.routes")
      .where("tostationid", toStationId)
      .first();
    const routeFromStationExistsInFrom = await db
      .select("*")
      .from("se_project.routes")
      .where("fromstationid", fromStationId)
      .first();
    const routeToStationExistsInFrom = await db
      .select("*")
      .from("se_project.routes")
      .where("fromstationid", toStationId)
      .first();
    const routeFromStationExistsInTo = await db
      .select("*")
      .from("se_project.routes")
      .where("tostationid", fromStationId)
      .first();
    if (existingBackwardRoute) {
      return res.status(200).send("Route Deleted Succesfully");
    }


    const routeFromExists = await db
      .select("*")
      .from("se_project.routes")
      .where("fromstationid", fromStationId).orWhere("tostationid", fromStationId)
      .first();

    const routeToExists = await db
      .select("*")
      .from("se_project.routes")
      .where("fromstationid", toStationId).orWhere("tostationid", toStationId)
      .first();

    if (!routeFromExists) {
      await db("se_project.stations")
        .where("id", fromStationId)
        .update({
          stationstatus: "new"
        });
    }
    if (!routeToExists) {
      await db("se_project.stations")
        .where("id", toStationId)
        .update({
          stationstatus: "new"
        });
    }

    const countToFrom = await db
      .count("*")
      .from("se_project.routes").
      where("fromstationid", toStationId);

    const countFromFrom = await db
      .count("*")
      .from("se_project.routes").
      where("fromstationid", fromStationId);

    const countFromTo = await db
      .count("*")
      .from("se_project.routes").
      where("tostationid", fromStationId);

    const countToTo = await db
      .count("*")
      .from("se_project.routes").
      where("tostationid", toStationId);
    if ((countToFrom[0].count) < 3 || (countToTo[0].count) < 3) {
      await db("se_project.stations")
        .where("id", toStationId)
        .update({
          stationtype: "normal"
        });
    }
    if ((countFromTo[0].count) < 3 || (countFromFrom[0].count) < 3) {
      await db("se_project.stations")
        .where("id", fromStationId)
        .update({
          stationtype: "normal"
        });
    }
    if ((countToFrom[0].count) >= 2 || (countToTo[0].count) >= 2) {
      return res.status(200).send("Route Deleted Succesfully");
    }
    if ((countFromTo[0].count) >= 2 || (countFromFrom[0].count) >= 2) {
      return res.status(200).send("Route Deleted Succesfully");
    }

    if (routeToStationExistsInFrom) {
      await db("se_project.stations")
        .where("id", toStationId)
        .update({
          stationposition: "start"
        });
    }
    else if (routeToStationExistsInTo) {
      await db("se_project.stations")
        .where("id", toStationId)
        .update({
          stationposition: "end"
        });
    }

    if (routeFromStationExistsInFrom) {
      await db("se_project.stations")
        .where("id", fromStationId)
        .update({
          stationposition: "start"
        });
    }
    else if (routeFromStationExistsInTo) {
      await db("se_project.stations")
        .where("id", fromStationId)
        .update({
          stationposition: "end"
        });
    }
    return res.status(200).send("Route deleted successfully");
  });

  //pay sub online
  app.post("/api/v1/payment/subscription/:purchasedId", async function (req, res) {
    
    var purchasedID =req.params.purchasedId;
    console.log(purchasedID);
    const CCN = req.body.creditCardNumber;
    const HOWN= req.body.holderName;
    const ammo= req.body.payedAmount;
    const typo= req.body.subType;
    const Zid= req.body.zoneId;
    const userd=await getUser(req);
    const userdd=userd.userid;
    console.log(Zid);
    console.log(userdd);
const subExists = await db
   .select("*")
   .from("se_project.subsription")
   .where("userid", userdd).andWhere("zoneid",Zid);
 if (!isEmpty(subExists)) {
  return res.status(400).send("subscription exists");
}

const niko={
  zoneid:Zid,
  subtype:"quartrly",
  nooftickets:0,
  userid:userdd
}
const yoo=await db("se_project.subsription").insert(niko).returning("*");
console.log(yoo);

 if(typo=="annual"){
   const ddo= await db("se_project.subsription")
   .where("zoneid",Zid  ).andWhere( "userid",userdd)
   .update({nooftickets:100,subtype:"annual"});
  }
  else{
    //duuno if month or monthly ba3den
    if(typo=="monthly"){
      const ddo=await db("se_project.subsription")
      .where("zoneid",Zid  ).andWhere( "userid",userdd)
      .update({nooftickets:50,subtype:"monthly"});
    }
    else{ 
      const ddo=await db("se_project.subsription")
      .where("zoneid",Zid  ).andWhere( "userid",userdd)
      .update({nooftickets:10,subtype:"quartrly"});
    }
  }
  const inserto={
    purchasedid:yoo[0].id,
    //amount from get ammount or body?
   amount:ammo,
    userid:userdd,
    purchasetype:"subscription",
   // zoneid:Zid
  };
  const ppo= await db("se_project.transactions").insert(inserto).returning("*");
  res.status(200).send("subscription paid"); 

  });

  app.post("/api/v1/payment/ticket/:purchasedId", async function (req, res) {
    var purchasedId = req.params.purchasedId;
    const CCN = req.body.creditCardNumber;
    const HOWN = req.body.holderName;
    const ammo = req.body.payedAmount;
    const origino = req.body.origin;
    const destinationo = req.body.destination;
    const tripDateo = req.body.tripDate;
    const tripTmp = new Date(tripDateo);
    const tripCompare = tripTmp.toISOString();
    const userdo = await getUser(req);
    const userpd = userdo.userid;
    ///////////////////////////
    const og = await db
      .select("id")
      .from("se_project.stations")
      .where("stationname", origino)
      .first();
    //
    const dn = await db
      .select("id")
      .from("se_project.stations")
      .where("stationname", destinationo)
      .first();
    const prico = await getPrice(og.id, dn.id);
    if (ammo != prico) { return res.status(400).send("invalid funds") }
    else {//the rest of the code
    }
    ////////////////////////////
    const subExists = await db
      .select("*")
      .from("se_project.subsription")
      .where("userid", userpd);
    if (!isEmpty(subExists)) {
      return res.status(400).send("You have a Subscription don't waste money");
    }
    else {
      
      const suyExists = await db
        .select("*")
        .from("se_project.tickets")
        .where("userid", userpd).andWhere("origin", origino).andWhere("destination", destinationo).andWhere("tripdate", tripCompare);
      if (!isEmpty(suyExists)) {
        return res.status(400).send("ticket already bought exists");
      }
      else {
        
        
        const insertouo = {

          //amount from get ammount or body?
          origin: origino,
          destination: destinationo,
          tripdate: tripDateo,
          userid: userpd,
          // subid:0
        };
        const ao = await db("se_project.tickets").insert(insertouo).returning("*");
        const insertog = {
          purchasedid: ao[0].id,
          //amount from get ammount or body?
          amount: ammo,
          userid: userpd,
          purchasetype: "ticket"
        };
        const poo = await db("se_project.transactions").insert(insertog).returning("*");
        const po = ao[0].id;
        ///////////////////////////////////////////////////////
        const inserta = {
          userid: userpd,
          status: "upcoming",
          origin: origino,
          destination: destinationo,
          ticketid: po,//po, 
          tripdate: tripDateo
        };
        const ppo = await db("se_project.rides").insert(inserta).returning("*")
        const transferStations = await getTransferStations(og.id, dn.id);
        let string = "";
        if (transferStations.length > 0) {
          string = "ticket paid\nTrip Date: " + tripDateo + "\nOrigin: " + origino + "\nDestination: " + destinationo + "\nTransfer Stations: ";
          for (let i = 0; i < transferStations.length; i++) {
            string += transferStations.shift().station + ", "
          }
          string = string.slice(0, -2);
        } else {
          string = "ticket paid\nTrip Date: " + tripDateo + "\nOrigin: " + origino + "\nDestination: " + destinationo;
        }
        return res.status(200).send(string);

      }
    }
  });
  /////////////////////////////////////////////////////////////////////////////////////////////
  app.post("/api/v1/tickets/purchase/subscription", async function (req, res) {
    const subid = req.body.subID;
    const origink = req.body.origio;
    const desitinationk = req.body.destin;
    const tripd = req.body.date;
    const tripTmp = new Date(tripd);
    const tripCompare = tripTmp.toISOString();
    const userd = await getUser(req);
    const userod = userd.userid;
    ///////////////////////////
    const og = await db
      .select("id")
      .from("se_project.stations")
      .where("stationname", origink)
      .first();
    const dn = await db
      .select("id")
      .from("se_project.stations")
      .where("stationname", desitinationk)
      .first();
    const prico = await getPrice(og.id, dn.id);
    const zone = await db.select("zoneid").from("se_project.subsription").where("id", subid).first();
    const zonePrice = await db.select("price").from("se_project.zones").where("id", zone.zoneid);
    if (zonePrice[0].price != prico) { return res.status(400).send("Invalid Subscription"); }
    const subExists = await db
      .select("*")
      .from("se_project.subsription")
      .where("id", subid);
    if (isEmpty(subExists)) {
      return res.status(400).send("sub doesn't  exist");
    }
    else {
      const suyExists = await db
        .select("*")
        .from("se_project.tickets")
        .where("userid", userod).andWhere("origin", origink).andWhere("destination", desitinationk).andWhere("tripdate", tripCompare);
      if (!isEmpty(suyExists)) {
        return res.status(400).send("ticket already bought exists");
      }
      else {
        const ino = {

          //amount from get ammount or body?
          origin: origink,
          destination: desitinationk,
          tripdate: tripd,
          userid: userod,
          subid: subid,
        };
        const apoo = await db("se_project.tickets").insert(ino).returning("id");
        const apo = parseInt(apoo[0]);
        ///////////////////////////////////////////////////////
        const insertak = {
          userid: userod,
          status: "upcoming",
          origin: origink,
          destination: desitinationk,
          tripdate: tripd,
          ticketid: apo
        };

        await db("se_project.rides").insert(insertak);
        const prevSub = await db.select("nooftickets").from("se_project.subsription").where("id", subid);
        await db("se_project.subsription")
          .where("id", subid)
          .update({
            nooftickets: prevSub[0].nooftickets - 1
          });
        const transferStations = await getTransferStations(og.id, dn.id);
        
        let string = "";
        if (transferStations.length > 0) {
          string = "ticket paid\nTrip Date: " + tripd + "\nOrigin: " + origink + "\nDestination: " + desitinationk + "\nTransfer Stations: ";
          const length=transferStations.length;
          for (let i = 0; i < length; i++) {
            //console.log(transferStations[i].station);
            string += transferStations.shift().station + ", ";
          }
          string = string.slice(0, -2);
        } else {
          string = "ticket paid\nTrip Date: " + tripd + "\nOrigin: " + origink + "\nDestination: " + desitinationk;
        }
        return res.status(200).send(string);
      }
    }
  });

  app.put("/api/v1/requests/senior/:requestId", async function (req, res) {

    const { requestId } = req.params;
    console.log(requestId);
    const reqExists = await db
      .select("*")
      .from("se_project.senior_requests")
      .where("id", requestId);
    if (isEmpty(reqExists)) {
      return res.status(400).send("request doesn't exist");
    }

    try {

      await db("se_project.senior_requests")
        .where("id", requestId)
        .update({
          status: (req.body.seniorStaus), 
        })
        .returning("*");
        const ss= await db.select("userid").from("se_project.senior_requests").where("id",requestId).first();
        await db("se_project.users")
        .where("id", ss.userid)
        .update({
          roleid: 3 
        })
        .returning("*");

      return res.status(200).send("successfully became old man");
    } catch (e) {
      console.log(e.message);
      return res.status(400).send("Couldn't update status");
    }

  });





  app.put("/api/v1/requests/refunds/:requestId", async function (req, res) {

    const { requestId } = req.params;
    const reqExists = await db
      .select("*")
      .from("se_project.refund_requests")
      .where("id", requestId);
    if (isEmpty(reqExists)) {
      return res.status(400).send("request doesn't exist");
    }

    const status = req.body.refundStaus;

    try {

      await db("se_project.refund_requests")
        .where("id", requestId)
        .update({
          status: status
        })
        .returning("*");

      if (status.toUpperCase() == "ACCEPTED") {
        const ticket = await db
          .select("ticketid")
          .from("se_project.refund_requests")
          .where("id", requestId)
          .first();

        const subId = await db
          .select("subid")
          .from("se_project.tickets")
          .where("id", ticket.ticketid)
          .first();

        if (subId.subid != undefined) {
          const prevSub = await db.select("nooftickets").from("se_project.subsription").where("id", subId.subid);
          await db("se_project.subsription")
            .where("id", subId.subid)
            .update({
              nooftickets: prevSub[0].nooftickets + 1
            });
        }

        await db("se_project.rides")
          .where("ticketid", ticket.ticketid)
          .delete();

        //delete ticket confuse *caveman sounds*
      }


      return res.status(200).send("done");
    } catch (e) {
      console.log(e.message);
      return res.status(400).send("Couldn't Refund Ticket");
    }






  });

  app.put("/api/v1/zones/:zoneId", async function (req, res) {
    const { zoneId } = req.params;
    const zoneExists = await db
      .select("*")
      .from("se_project.zones")
      .where("id", zoneId);
    if (isEmpty(zoneExists)) {
      return res.status(400).send("zone doesn't exist");
    }

    try {

      await db("se_project.zones")
        .where("id", zoneId)
        .update({
          price: req.body.price
        })
        .returning("*");


      return res.status(200).send("update successfully");
    } catch (e) {
      console.log(e.message);
      return res.status(400).send("error zone price not updated");
    }


  });
}
