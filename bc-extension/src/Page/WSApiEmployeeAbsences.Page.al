/// <summary>
/// Employee absences (sickness KRANK, vacation URLAUB). Default target for absences
/// until OP-01 ("Zeiterfassungsposten") is clarified. Idempotent via monteurAppId.
/// No health data: description must only contain neutral text.
/// </summary>
page 50112 "WS API Employee Absences"
{
    PageType = API;
    APIPublisher = 'schroeder';
    APIGroup = 'werkstatt';
    APIVersion = 'v1.0';
    EntityName = 'employeeAbsence';
    EntitySetName = 'employeeAbsences';
    EntityCaption = 'Employee Absence';
    EntitySetCaption = 'Employee Absences';
    SourceTable = "Employee Absence";
    ODataKeyFields = SystemId;
    DelayedInsert = true;
    InsertAllowed = true;
    ModifyAllowed = false;
    DeleteAllowed = true; // cancellation of approved vacation (storno)
    ChangeTrackingAllowed = true;
    Extensible = false;

    layout
    {
        area(Content)
        {
            repeater(Records)
            {
                field(id; Rec.SystemId) { Editable = false; }
                field(monteurAppId; Rec."Monteur App Id") { }
                field(entryNumber; Rec."Entry No.") { Editable = false; }
                field(employeeNumber; Rec."Employee No.") { }
                field(fromDate; Rec."From Date") { }
                field(toDate; Rec."To Date") { }
                field(causeOfAbsenceCode; Rec."Cause of Absence Code") { }
                field(description; Rec.Description) { }
                field(unitOfMeasureCode; Rec."Unit of Measure Code") { }
                field(quantity; Rec.Quantity) { }
                field(lastModifiedDateTime; Rec.SystemModifiedAt) { Editable = false; }
            }
        }
    }

    var
        ApiHelper: Codeunit "WS Api Helper";

    trigger OnInsertRecord(BelowxRec: Boolean): Boolean
    var
        Existing: Record "Employee Absence";
    begin
        ApiHelper.RequireMonteurAppId(Rec."Monteur App Id");

        Existing.SetRange("Monteur App Id", Rec."Monteur App Id");
        if Existing.FindFirst() then begin
            Rec := Existing;
            exit(false);
        end;

        Rec."Entry No." := ApiHelper.NextEmployeeAbsenceEntryNo();
        Rec.Insert(true);
        exit(false);
    end;
}
