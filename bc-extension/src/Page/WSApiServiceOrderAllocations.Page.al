/// <summary>
/// Service order allocations (resource planning). POST is used by the planning board
/// of the Monteur-App. Idempotent via monteurAppId.
/// </summary>
page 50109 "WS API Service Order Allocs."
{
    PageType = API;
    APIPublisher = 'schroeder';
    APIGroup = 'werkstatt';
    APIVersion = 'v1.0';
    EntityName = 'serviceOrderAllocation';
    EntitySetName = 'serviceOrderAllocations';
    EntityCaption = 'Service Order Allocation';
    EntitySetCaption = 'Service Order Allocations';
    SourceTable = "Service Order Allocation";
    SourceTableView = where("Document Type" = const(Order));
    ODataKeyFields = SystemId;
    DelayedInsert = true;
    InsertAllowed = true;
    ModifyAllowed = false;
    DeleteAllowed = false;
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
                field(documentNumber; Rec."Document No.") { }
                field(serviceItemLineNumber; Rec."Service Item Line No.") { }
                field(resourceNumber; Rec."Resource No.") { }
                field(allocationDate; Rec."Allocation Date") { }
                field(startingTime; Rec."Starting Time") { }
                field(finishingTime; Rec."Finishing Time") { }
                field(allocatedHours; Rec."Allocated Hours") { }
                field(status; Rec.Status) { Editable = false; }
                field(lastModifiedDateTime; Rec.SystemModifiedAt) { Editable = false; }
            }
        }
    }

    var
        ApiHelper: Codeunit "WS Api Helper";

    trigger OnNewRecord(BelowxRec: Boolean)
    begin
        Rec."Document Type" := Rec."Document Type"::Order;
    end;

    trigger OnInsertRecord(BelowxRec: Boolean): Boolean
    var
        Existing: Record "Service Order Allocation";
    begin
        ApiHelper.RequireMonteurAppId(Rec."Monteur App Id");

        Existing.SetRange("Monteur App Id", Rec."Monteur App Id");
        if Existing.FindFirst() then begin
            Rec := Existing;
            exit(false);
        end;

        Rec."Document Type" := Rec."Document Type"::Order;
        Rec."Entry No." := ApiHelper.NextAllocationEntryNo();
        Rec.Insert(true);
        exit(false);
    end;
}
