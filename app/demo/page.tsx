import DemoClient from "./DemoClient";
import { LanguageProvider } from "../components/LanguageContext";
import { archiveName, ownerEmail } from "../../lib/archive-config";
import "./demo.css";

export function generateMetadata() { return { title: `Try the archivist · ${archiveName()}` }; }
export default function DemoPage() { return <LanguageProvider initial="en"><DemoClient archiveAvailable={Boolean(ownerEmail())} /></LanguageProvider>; }
