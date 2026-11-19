/// <summary>
/// Writes deletions of synchronized tables into "WS Deleted Record"
/// so the Monteur-App can remove them from its local mirror.
/// </summary>
codeunit 50100 "WS Deleted Record Log"
{
    Access = Internal;
    Permissions = tabledata "WS Deleted Record" = I;

    [EventSubscriber(ObjectType::Table, Database::"Service Header", 'OnAfterDeleteEvent', '', false, false)]
    local procedure ServiceHeaderOnAfterDelete(var Rec: Record "Service Header"; RunTrigger: Boolean)
    begin
        if Rec.IsTemporary() then
            exit;
        if Rec."Document Type" <> Rec."Document Type"::Order then
            exit;
        LogDeletion(Database::"Service Header", Rec.SystemId);
    end;

    [EventSubscriber(ObjectType::Table, Database::"Service Item Line", 'OnAfterDeleteEvent', '', false, false)]
    local procedure ServiceItemLineOnAfterDelete(var Rec: Record "Service Item Line"; RunTrigger: Boolean)
    begin
        if Rec.IsTemporary() then
            exit;
        if Rec."Document Type" <> Rec."Document Type"::Order then
            exit;
        LogDeletion(Database::"Service Item Line", Rec.SystemId);
    end;

    [EventSubscriber(ObjectType::Table, Database::"Service Line", 'OnAfterDeleteEvent', '', false, false)]
    local procedure ServiceLineOnAfterDelete(var Rec: Record "Service Line"; RunTrigger: Boolean)
    begin
        if Rec.IsTemporary() then
            exit;
        if Rec."Document Type" <> Rec."Document Type"::Order then
            exit;
        LogDeletion(Database::"Service Line", Rec.SystemId);
    end;

    [EventSubscriber(ObjectType::Table, Database::"Service Order Allocation", 'OnAfterDeleteEvent', '', false, false)]
    local procedure ServiceOrderAllocationOnAfterDelete(var Rec: Record "Service Order Allocation"; RunTrigger: Boolean)
    begin
        if Rec.IsTemporary() then
            exit;
        LogDeletion(Database::"Service Order Allocation", Rec.SystemId);
    end;

    [EventSubscriber(ObjectType::Table, Database::"Service Item", 'OnAfterDeleteEvent', '', false, false)]
    local procedure ServiceItemOnAfterDelete(var Rec: Record "Service Item"; RunTrigger: Boolean)
    begin
        if Rec.IsTemporary() then
            exit;
        LogDeletion(Database::"Service Item", Rec.SystemId);
    end;

    [EventSubscriber(ObjectType::Table, Database::"Employee Absence", 'OnAfterDeleteEvent', '', false, false)]
    local procedure EmployeeAbsenceOnAfterDelete(var Rec: Record "Employee Absence"; RunTrigger: Boolean)
    begin
        if Rec.IsTemporary() then
            exit;
        LogDeletion(Database::"Employee Absence", Rec.SystemId);
    end;

    local procedure LogDeletion(TableNo: Integer; RecSystemId: Guid)
    var
        DeletedRecord: Record "WS Deleted Record";
    begin
        DeletedRecord.Init();
        DeletedRecord."Table No." := TableNo;
        DeletedRecord."Record SystemId" := RecSystemId;
        DeletedRecord."Deleted At" := CurrentDateTime();
        DeletedRecord.Insert();
    end;
}
