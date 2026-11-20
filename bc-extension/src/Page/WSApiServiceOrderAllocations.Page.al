/// <summary>
/// Service order allocations (resource planning). POST is used by the planning board
/// of the Monteur-App (idempotent via monteurAppId); PATCH moves an allocation
/// (resource, date, times) or cancels it (status = Canceled).
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
    ModifyAllowed = true;
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
                field(monteurAppId; Rec."Monteur App Id") { Editable = IsNew; }
                field(documentNumber; Rec."Document No.") { Editable = IsNew; }
                field(serviceItemLineNumber; Rec."Service Item Line No.") { }
                field(resourceNumber; Rec."Resource No.") { }
                field(allocationDate; Rec."Allocation Date") { }
                field(startingTime; Rec."Starting Time") { }
                field(finishingTime; Rec."Finishing Time") { }
                field(allocatedHours; Rec."Allocated Hours") { }
                // TO VERIFY in the tenant (OFFENE-PUNKTE OP-21): whether BC accepts cancelling via the
                // status field or requires the standard cancel function with a reason code.
                field(status; Rec.Status) { }
                field(lastModifiedDateTime; Rec.SystemModifiedAt) { Editable = false; }
            }
        }
    }

    var
        ApiHelper: Codeunit "WS Api Helper";
        IsNew: Boolean;

    trigger OnAfterGetRecord()
    begin
        IsNew := false;
    end;

    trigger OnModifyRecord(): Boolean
    begin
        if Rec.Status = Rec.Status::Canceled then
            Rec."Allocated Hours" := 0;
        Rec.Modify(true);
        exit(false);
    end;

    trigger OnNewRecord(BelowxRec: Boolean)
    begin
        IsNew := true;
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
