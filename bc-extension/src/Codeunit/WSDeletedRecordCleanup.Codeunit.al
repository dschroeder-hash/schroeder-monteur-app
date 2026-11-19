/// <summary>
/// Job queue entry: removes deletion log entries older than 30 days.
/// The Monteur-App reads the log every few minutes, so 30 days is ample.
/// </summary>
codeunit 50101 "WS Deleted Record Cleanup"
{
    Access = Internal;
    Permissions = tabledata "WS Deleted Record" = RD;

    trigger OnRun()
    var
        DeletedRecord: Record "WS Deleted Record";
    begin
        DeletedRecord.SetRange("Deleted At", 0DT, CreateDateTime(Today() - 30, 0T));
        DeletedRecord.DeleteAll();
    end;
}
