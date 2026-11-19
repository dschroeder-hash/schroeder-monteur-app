/// <summary>
/// Permissions for the Monteur-App service-to-service (S2S) Entra application.
/// Assign together with the standard sets listed in docs/SETUP-BC.md, because validation
/// of service lines and journals reads many further tables (setup, dimensions, prices, ...).
/// </summary>
permissionset 50100 "WS WERKSTATT API"
{
    Caption = 'Werkstatt API (Monteur-App)';
    Assignable = true;

    Permissions =
        // own objects
        tabledata "WS Deleted Record" = RIMD,
        table "WS Deleted Record" = X,
        codeunit "WS Deleted Record Log" = X,
        codeunit "WS Deleted Record Cleanup" = X,
        codeunit "WS Api Helper" = X,
        page "WS API Service Orders" = X,
        page "WS API Service Order Items" = X,
        page "WS API Service Items" = X,
        page "WS API Resources" = X,
        page "WS API Service Order Types" = X,
        page "WS API Responsibility Centers" = X,
        page "WS API Causes of Absence" = X,
        page "WS API Work Types" = X,
        page "WS API Item References" = X,
        page "WS API Service Order Allocs." = X,
        page "WS API Service Lines" = X,
        page "WS API Service Comment Lines" = X,
        page "WS API Employee Absences" = X,
        page "WS API Res. Journal Lines" = X,
        page "WS API Item Journal Lines" = X,
        page "WS API Posted Service Invoices" = X,
        page "WS API Deleted Records" = X,
        query "WS API Item Availability" = X,
        // read sources
        tabledata "Service Header" = RM,
        tabledata "Service Item Line" = R,
        tabledata "Service Item" = R,
        tabledata Resource = R,
        tabledata "Service Order Type" = R,
        tabledata "Responsibility Center" = R,
        tabledata "Cause of Absence" = R,
        tabledata "Work Type" = R,
        tabledata "Item Reference" = R,
        tabledata Item = R,
        tabledata "Item Ledger Entry" = R,
        tabledata "Service Invoice Header" = R,
        // write targets (insert only, no posting)
        tabledata "Service Line" = RIM,
        tabledata "Service Order Allocation" = RIM,
        tabledata "Service Comment Line" = RIM,
        tabledata "Employee Absence" = RIMD,
        tabledata "Res. Journal Line" = RIM,
        tabledata "Item Journal Line" = RIM;
}
