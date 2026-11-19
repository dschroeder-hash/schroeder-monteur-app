/// <summary>
/// Item journal lines for internal consumption (e.g. diesel for service vans or demo machines,
/// with cost center dimension). Lines are created unposted. Idempotent via monteurAppId.
/// </summary>
page 50114 "WS API Item Journal Lines"
{
    PageType = API;
    APIPublisher = 'schroeder';
    APIGroup = 'werkstatt';
    APIVersion = 'v1.0';
    EntityName = 'itemJournalLine';
    EntitySetName = 'itemJournalLines';
    EntityCaption = 'Item Journal Line';
    EntitySetCaption = 'Item Journal Lines';
    SourceTable = "Item Journal Line";
    ODataKeyFields = SystemId;
    DelayedInsert = true;
    InsertAllowed = true;
    ModifyAllowed = false;
    DeleteAllowed = false;
    Extensible = false;

    layout
    {
        area(Content)
        {
            repeater(Records)
            {
                field(id; Rec.SystemId) { Editable = false; }
                field(monteurAppId; Rec."Monteur App Id") { }
                field(journalTemplateName; Rec."Journal Template Name") { }
                field(journalBatchName; Rec."Journal Batch Name") { }
                field(lineNumber; Rec."Line No.") { Editable = false; }
                field(postingDate; Rec."Posting Date") { }
                field(entryType; Rec."Entry Type") { }
                field(documentNumber; Rec."Document No.") { }
                field(itemNumber; Rec."Item No.") { }
                field(locationCode; Rec."Location Code") { }
                field(unitOfMeasureCode; Rec."Unit of Measure Code") { }
                field(quantity; Rec.Quantity) { }
                field(shortcutDimension1Code; Rec."Shortcut Dimension 1 Code") { }
                field(shortcutDimension2Code; Rec."Shortcut Dimension 2 Code") { }
                field(description; Rec.Description) { }
                field(lastModifiedDateTime; Rec.SystemModifiedAt) { Editable = false; }
            }
        }
    }

    var
        ApiHelper: Codeunit "WS Api Helper";

    trigger OnInsertRecord(BelowxRec: Boolean): Boolean
    var
        Existing: Record "Item Journal Line";
    begin
        ApiHelper.RequireMonteurAppId(Rec."Monteur App Id");

        Existing.SetRange("Monteur App Id", Rec."Monteur App Id");
        if Existing.FindFirst() then begin
            Rec := Existing;
            exit(false);
        end;

        Rec."Line No." := ApiHelper.NextItemJournalLineNo(Rec."Journal Template Name", Rec."Journal Batch Name");
        Rec.Insert(true);
        exit(false);
    end;
}
