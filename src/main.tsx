import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import LabWorkspace from "../components/lab/LabWorkspace";
import Connect from "./Connect";
import "../app/globals.css";
import "../app/lab/lab.css";
import "katex/dist/katex.min.css";
function DemoNotice(){const [demo,setDemo]=useState(false);useEffect(()=>{fetch("/api/me").then(r=>r.json() as Promise<{demo?:boolean}>).then(v=>setDemo(v.demo===true)).catch(()=>{});},[]);return demo?<div className="demo-notice">Fictional demo workspace · illustrative dates</div>:null;}
createRoot(document.getElementById("root")!).render(<React.StrictMode>{location.pathname === "/connect" ? <Connect /> : <LabWorkspace />}<DemoNotice /></React.StrictMode>);
