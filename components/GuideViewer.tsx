
import React from 'react';

export const GuideViewer: React.FC = () => {
  return (
    <div className="flex-1 h-full overflow-y-auto bg-slate-50 p-8 print:p-0 print:bg-white">
      <div className="max-w-5xl mx-auto bg-white shadow-sm border border-slate-200 rounded-xl overflow-hidden print:shadow-none print:border-none">
        
        {/* Header */}
        <div className="bg-slate-900 text-white p-10 print:p-0 print:text-black print:bg-white print:border-b print:border-black print:mb-8">
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold tracking-tight">Origin Hardware Architecture Studio</h1>
            <span className="bg-blue-600 text-white text-xs font-bold px-2 py-1 rounded">V3.6</span>
          </div>
          <p className="text-slate-300 text-lg font-light print:text-slate-600">
            Systems Engineering Visualization & Validation Platform
          </p>
        </div>

        <div className="p-10 prose prose-slate max-w-none prose-headings:font-bold prose-h2:text-slate-800 prose-h3:text-slate-700 prose-a:text-blue-600">
            
            {/* 1. Workflow Overview */}
            <section className="mb-16">
                <h2 className="text-2xl border-b border-slate-200 pb-2 mb-6">1. Operational Workflow</h2>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="bg-slate-50 p-6 rounded-lg border border-slate-200">
                        <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold mb-4">1</div>
                        <h3 className="text-lg font-bold mb-2 mt-0">Define</h3>
                        <p className="text-sm text-slate-600 mb-0">Engineers define the system architecture in a standard <strong>Google Sheet</strong>. This serves as the "Source of Truth".</p>
                    </div>
                    <div className="bg-slate-50 p-6 rounded-lg border border-slate-200">
                        <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold mb-4">2</div>
                        <h3 className="text-lg font-bold mb-2 mt-0">Sync</h3>
                        <p className="text-sm text-slate-600 mb-0">Publish the sheet to the web as a CSV. Origin Studio syncs with this live data stream instantly.</p>
                    </div>
                    <div className="bg-slate-50 p-6 rounded-lg border border-slate-200">
                        <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center font-bold mb-4">3</div>
                        <h3 className="text-lg font-bold mb-2 mt-0">Visualize</h3>
                        <p className="text-sm text-slate-600 mb-0">The platform generates high-fidelity diagrams via Mermaid.AI and performs connectivity validation.</p>
                    </div>
                </div>
            </section>

            {/* 2. Google Sheets Integration */}
            <section className="mb-16">
                <h2 className="text-2xl border-b border-slate-200 pb-2 mb-6">2. Data Synchronization</h2>
                
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
                    <h3 className="text-blue-900 text-lg font-bold mt-0 mb-2">Publishing Your Data</h3>
                    <p className="text-blue-800 text-sm mb-4">Origin requires a raw CSV stream. You cannot use the standard "Share" link.</p>
                    <ol className="list-decimal pl-5 text-sm text-blue-900 space-y-2 font-medium">
                        <li>Open your Google Sheet.</li>
                        <li>Navigate to <strong>File &gt; Share &gt; Publish to web</strong>.</li>
                        <li>Change "Web page" to <strong>Comma-separated values (.csv)</strong>.</li>
                        <li>Click <strong>Publish</strong> and copy the generated link.</li>
                        <li>Paste this link into the sidebar in Origin Studio.</li>
                    </ol>
                </div>

                <div className="flex items-start gap-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                    <span className="text-2xl">⚠️</span>
                    <div>
                        <strong className="text-amber-900 block text-sm">Caching Delay</strong>
                        <p className="text-amber-800 text-xs m-0">Google Sheets caches the published CSV. Changes made in the sheet may take up to 3-5 minutes to appear in Origin, even if you click "Import Data" repeatedly.</p>
                    </div>
                </div>
            </section>

            {/* 3. CSV Schema */}
            <section className="mb-16">
                <h2 className="text-2xl border-b border-slate-200 pb-2 mb-6">3. Data Schema Reference</h2>
                <p className="text-slate-600 mb-4">Your Google Sheet <strong>Row 1</strong> must contain these exact headers. Order does not matter.</p>
                
                <div className="overflow-x-auto border border-slate-200 rounded-lg shadow-sm">
                    <table className="min-w-full text-sm text-left m-0">
                        <thead className="bg-slate-100 text-slate-700 font-bold uppercase">
                            <tr>
                                <th className="px-4 py-3 border-b border-slate-200 w-1/4">Column Name</th>
                                <th className="px-4 py-3 border-b border-slate-200 w-1/6">Required</th>
                                <th className="px-4 py-3 border-b border-slate-200">Description & Rules</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                            <tr>
                                <td className="px-4 py-3 font-mono font-bold text-slate-900">Source Component</td>
                                <td className="px-4 py-3"><span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs font-bold">YES</span></td>
                                <td className="px-4 py-3">
                                    Unique ID of the start node. <br/>
                                    <span className="text-slate-500 text-xs">Example: <code>Battery_HV</code>, <code>ECU_Main</code></span>
                                </td>
                            </tr>
                            <tr>
                                <td className="px-4 py-3 font-mono font-bold text-slate-900">Source Component Part Name</td>
                                <td className="px-4 py-3"><span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs">Optional</span></td>
                                <td className="px-4 py-3">
                                    Real-world commercial part number.<br/>
                                    <span className="text-slate-500 text-xs">Example: <code>Amphenol SurLok Plus</code></span>
                                </td>
                            </tr>
                             <tr>
                                <td className="px-4 py-3 font-mono font-bold text-slate-900">Source Component Datasheet Link</td>
                                <td className="px-4 py-3"><span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs">Optional</span></td>
                                <td className="px-4 py-3">
                                    URL to PDF or product page. Makes the node clickable in the table.<br/>
                                    <span className="text-slate-500 text-xs">Example: <code>https://mouser.com/...</code></span>
                                </td>
                            </tr>
                            <tr>
                                <td className="px-4 py-3 font-mono font-bold text-slate-900">Destination Component</td>
                                <td className="px-4 py-3"><span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs font-bold">YES</span></td>
                                <td className="px-4 py-3">
                                    Unique ID of the end node. <br/>
                                    <span className="text-slate-500 text-xs">Example: <code>Inverter_Front</code>, <code>Fuse_Box_1</code></span>
                                </td>
                            </tr>
                            <tr>
                                <td className="px-4 py-3 font-mono font-bold text-slate-900">Architecture Type</td>
                                <td className="px-4 py-3"><span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs font-bold">YES</span></td>
                                <td className="px-4 py-3">
                                    Determines diagram layer and wire color. Must be exactly:
                                    <div className="flex gap-2 mt-1">
                                        <span className="text-xs bg-red-100 text-red-700 px-1 rounded border border-red-200">Power</span>
                                        <span className="text-xs bg-blue-100 text-blue-700 px-1 rounded border border-blue-200">Comm</span>
                                        <span className="text-xs bg-yellow-100 text-yellow-700 px-1 rounded border border-yellow-200">Safety</span>
                                        <span className="text-xs bg-green-100 text-green-700 px-1 rounded border border-green-200">Ground</span>
                                    </div>
                                </td>
                            </tr>
                            <tr>
                                <td className="px-4 py-3 font-mono font-bold text-slate-900">FunctionalWireName</td>
                                <td className="px-4 py-3"><span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs font-bold">YES</span></td>
                                <td className="px-4 py-3">
                                    Label displayed on the connection line. <br/>
                                    <span className="text-slate-500 text-xs">Example: <code>48V DC</code>, <code>CAN High</code>, <code>E-Stop Loop</code></span>
                                </td>
                            </tr>
                            <tr>
                                <td className="px-4 py-3 font-mono font-bold text-slate-900">WireSpecifications</td>
                                <td className="px-4 py-3"><span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs">Optional</span></td>
                                <td className="px-4 py-3">
                                    Formal physical construction notation.<br/>
                                    <span className="text-slate-500 text-xs">Example: <code>2x 18AWG</code>, <code>Twisted Pair</code></span>
                                </td>
                            </tr>
                            <tr>
                                <td className="px-4 py-3 font-mono font-bold text-slate-900">FunctionalGroup</td>
                                <td className="px-4 py-3"><span className="bg-red-100 text-red-700 px-2 py-0.5 rounded text-xs font-bold">YES</span></td>
                                <td className="px-4 py-3">
                                    Logical subsystem. Forces nodes to cluster together in diagrams. <br/>
                                    <span className="text-slate-500 text-xs">Example: <code>Powertrain</code>, <code>Cabin_Controls</code>, <code>Lighting</code></span>
                                </td>
                            </tr>
                            <tr>
                                <td className="px-4 py-3 font-mono font-bold text-slate-900">SourceComponentCompartment</td>
                                <td className="px-4 py-3"><span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs">Optional</span></td>
                                <td className="px-4 py-3">
                                    Physical location zone for the source node. Used in Spatial View.<br/>
                                    <span className="text-slate-500 text-xs">Example: <code>Engine_Bay</code>, <code>Battery_Box</code></span>
                                </td>
                            </tr>
                            <tr>
                                <td className="px-4 py-3 font-mono font-bold text-slate-900">DestinationComponentCompartment</td>
                                <td className="px-4 py-3"><span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs">Optional</span></td>
                                <td className="px-4 py-3">
                                    Physical location zone for the destination node. Used in Spatial View.<br/>
                                    <span className="text-slate-500 text-xs">Example: <code>Rear_Chassis</code>, <code>Cabin</code></span>
                                </td>
                            </tr>
                            <tr>
                                <td className="px-4 py-3 font-mono font-bold text-slate-900">Average Power</td>
                                <td className="px-4 py-3"><span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs">Optional</span></td>
                                <td className="px-4 py-3">Typical power consumption/supply (e.g., <code>50W</code>). Used for estimation.</td>
                            </tr>
                            <tr>
                                <td className="px-4 py-3 font-mono font-bold text-slate-900">Max Continuous Power</td>
                                <td className="px-4 py-3"><span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs">Optional</span></td>
                                <td className="px-4 py-3">Rated continuous power limit (e.g., <code>100W</code>, <code>2.5kW</code>). Used for safety validation.</td>
                            </tr>
                             <tr>
                                <td className="px-4 py-3 font-mono font-bold text-slate-900">Peak Power</td>
                                <td className="px-4 py-3"><span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs">Optional</span></td>
                                <td className="px-4 py-3">Absolute maximum power spike (e.g., <code>200W</code>).</td>
                            </tr>
                             <tr>
                                <td className="px-4 py-3 font-mono font-bold text-slate-900">Peak Power Transient Time</td>
                                <td className="px-4 py-3"><span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs">Optional</span></td>
                                <td className="px-4 py-3">Duration of the peak power event (e.g., <code>100ms</code>, <code>2s</code>).</td>
                            </tr>
                             <tr>
                                <td className="px-4 py-3 font-mono font-bold text-slate-900">Power Direction</td>
                                <td className="px-4 py-3"><span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs">Optional</span></td>
                                <td className="px-4 py-3">
                                    Defines flow logic. 
                                    <ul className="list-disc pl-4 mt-1">
                                        <li><code>SD</code>: Source → Destination (Default)</li>
                                        <li><code>DS</code>: Destination → Source (e.g. Regen)</li>
                                    </ul>
                                </td>
                            </tr>
                             <tr>
                                <td className="px-4 py-3 font-mono font-bold text-slate-900">Notes</td>
                                <td className="px-4 py-3"><span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded text-xs">Optional</span></td>
                                <td className="px-4 py-3">
                                   Any engineering notes, questions, or flags.
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>

             {/* 4. Visualization Types */}
             <section className="mb-16">
                 <h2 className="text-2xl border-b border-slate-200 pb-2 mb-6">4. Visualization & Analysis</h2>
                 
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                     <div className="border border-slate-200 rounded-lg p-5 hover:shadow-md transition-shadow">
                         <div className="flex items-center gap-2 mb-3">
                             <div className="w-3 h-3 rounded-full bg-red-500"></div>
                             <h3 className="text-lg font-bold m-0">Power Architecture</h3>
                         </div>
                         <p className="text-sm text-slate-600">Filters specifically for High Voltage and Low Voltage power distribution. Good for validating fusing strategies and load switching.</p>
                     </div>

                     <div className="border border-slate-200 rounded-lg p-5 hover:shadow-md transition-shadow">
                         <div className="flex items-center gap-2 mb-3">
                             <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                             <h3 className="text-lg font-bold m-0">Communication Bus</h3>
                         </div>
                         <p className="text-sm text-slate-600">Visualizes CAN bus topology, Ethernet backbones, and sensor data lines. Helps identify daisy-chain issues or star-topology bottlenecks.</p>
                     </div>

                     <div className="border border-slate-200 rounded-lg p-5 hover:shadow-md transition-shadow">
                         <div className="flex items-center gap-2 mb-3">
                             <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                             <h3 className="text-lg font-bold m-0">Safety Systems</h3>
                         </div>
                         <p className="text-sm text-slate-600">Isolates E-Stop loops, Interlock (HVIL) circuits, and critical fault lines. Essential for FMEA analysis.</p>
                     </div>

                     <div className="border border-slate-200 rounded-lg p-5 hover:shadow-md transition-shadow">
                         <div className="flex items-center gap-2 mb-3">
                             <div className="w-3 h-3 rounded-full bg-slate-600"></div>
                             <h3 className="text-lg font-bold m-0">Spatial Layout</h3>
                         </div>
                         <p className="text-sm text-slate-600">Ignores the logical function and groups components by their <code>Compartment</code>. Useful for harness routing and connector placement.</p>
                     </div>
                     
                     <div className="border border-slate-200 rounded-lg p-5 hover:shadow-md transition-shadow">
                         <div className="flex items-center gap-2 mb-3">
                             <div className="w-3 h-3 rounded-full bg-green-500"></div>
                             <h3 className="text-lg font-bold m-0">Grounding Architecture</h3>
                         </div>
                         <p className="text-sm text-slate-600">
                             Visualizes the earthing strategy. Crucial for detecting ground loops and ensuring all chassis bonds are present. 
                             Connect components to a common node (e.g. <code>Chassis_GND</code>) using the Architecture Type <code>Ground</code>.
                         </p>
                     </div>
                 </div>

                 <div className="bg-slate-50 p-6 rounded-lg border border-slate-200">
                     <h3 className="font-bold text-slate-800 mt-0 mb-4">🔍 Component Architecture Coverage</h3>
                     <p className="mb-4 text-sm text-slate-600">
                         The table at the bottom of the dashboard is more than just a list. It is a powerful analytical tool.
                     </p>
                     
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                         <div>
                             <h4 className="font-bold text-sm text-slate-900 mb-2">1. Drill-Down Visualization</h4>
                             <p className="text-xs text-slate-600 mb-2">
                                 Clicking any <strong>Component ID</strong> immediately opens a focused diagram showing <strong>only</strong> that component and its direct neighbors.
                             </p>
                             <div className="flex items-center gap-4 bg-white p-3 rounded border border-slate-200 text-xs">
                                 <span className="text-blue-600 font-mono border-b border-blue-600 cursor-pointer">ECU_Main</span>
                                 <span className="text-slate-400">→</span>
                                 <span className="text-slate-500">Opens isolated view</span>
                             </div>
                         </div>

                         <div>
                             <h4 className="font-bold text-sm text-slate-900 mb-2">2. Filtered Diagram Generation</h4>
                             <p className="text-xs text-slate-600 mb-2">
                                 You can filter the table using the inputs in the header (e.g., show only components with <code>Power In > 500W</code>).
                             </p>
                             <p className="text-xs text-slate-600">
                                 Once filtered, click the <span className="text-blue-600 font-bold border-b border-blue-600">Component Architecture Coverage</span> title to generate a full system diagram containing <strong>only</strong> the visible components.
                             </p>
                         </div>
                     </div>
                 </div>
            </section>

             {/* 5. Advanced Layout Engine */}
             <section className="mb-16">
                 <h2 className="text-2xl border-b border-slate-200 pb-2 mb-6">5. Layout Engine (ELK)</h2>
                 <p className="text-slate-600 mb-4">
                     Origin utilizes the <strong>ELK (Eclipse Layout Kernel)</strong> renderer within Mermaid. This differs from standard flowcharts.
                 </p>
                 <ul className="list-disc pl-5 space-y-3 text-slate-700">
                    <li>
                        <strong>Grouping is Mandatory:</strong> ELK relies heavily on the <code>FunctionalGroup</code> column. If components are not grouped, the graph will be a flat, disorganized list.
                    </li>
                    <li>
                        <strong>Busbar Visualization:</strong> Any Component ID containing the string <code>Bus</code> (case-insensitive) is automatically rendered with a special "Busbar" style (thick border, white fill).
                    </li>
                    <li>
                        <strong>Wire Colors:</strong> 
                        <span className="inline-block w-3 h-3 bg-red-500 rounded-full mx-2"></span>Power 
                        <span className="inline-block w-3 h-3 bg-blue-500 rounded-full mx-2"></span>Comm 
                        <span className="inline-block w-3 h-3 bg-yellow-500 rounded-full mx-2"></span>Safety 
                        <span className="inline-block w-3 h-3 bg-green-500 rounded-full mx-2"></span>Ground
                    </li>
                 </ul>
            </section>

        </div>
      </div>
    </div>
  );
};
