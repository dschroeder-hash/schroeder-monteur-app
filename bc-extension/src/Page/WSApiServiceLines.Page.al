/// <summary>
/// Service lines of service orders. POST creates a resource line (time) or an item line
/// (parts / consumables) after master approval in the Monteur-App. Never posts.
/// Idempotent: a second POST with the same monteurAppId returns the existing line.
/// Field order below is the validation order (document, service item line, type, no., location, quantity, UoM, work type).
/// </summary>
page 50110 "WS API Service Lines"
{
    PageType = API;
    APIPublisher = 'schroeder';
    APIGroup = 'werkstatt';
    APIVersion = 'v1.0';
    EntityName = 'serviceLine';
    EntitySetName = 'serviceLines';
    EntityCaption = 'Service Line';
    EntitySetCaption = 'Service Lines';
    SourceTable = "Service Line";
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
                field(lineNumber; Rec."Line No.") { Editable = false; }
                field(serviceItemLineNumber; Rec."Service Item Line No.") { }
                field(type; Rec.Type) { }
                field(number; Rec."No.") { }
                field(locationCode; Rec."Location Code") { }
                field(quantity; Rec.Quantity) { }
                field(unitOfMeasureCode; Rec."Unit of Measure Code") { }
                field(workTypeCode; Rec."Work Type Code") { }
                field(description; Rec.Description) { }
                field(quantityShipped; Rec."Quantity Shipped") { Editable = false; }
                field(quantityConsumed; Rec."Quantity Consumed") { Editable = false; }
                field(quantityInvoiced; Rec."Quantity Invoiced") { Editable = false; }
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
        Existing: Record "Service Line";
    begin
        ApiHelper.RequireMonteurAppId(Rec."Monteur App Id");

        Existing.SetRange("Monteur App Id", Rec."Monteur App Id");
        if Existing.FindFirst() then begin
            Rec := Existing;
            exit(false);
        end;

        Rec."Document Type" := Rec."Document Type"::Order;
        Rec."Line No." := ApiHelper.NextServiceLineNo(Rec."Document No.");
        Rec.Insert(true);
        exit(false);
    end;
}
