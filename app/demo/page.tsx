import DemoClient from "./DemoClient";
import { LanguageProvider } from "../components/LanguageContext";
import { archiveName } from "../../lib/archive-config";

export function generateMetadata() { return { title: `Try the archivist · ${archiveName()}` }; }
export default function DemoPage() { return <LanguageProvider initial="en"><DemoClient /></LanguageProvider>; }
