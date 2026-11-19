/// <summary>
/// Resource journal lines (overhead times, alternative time target). Lines are created
/// unposted; posting stays a manual BC task. Idempotent via monteurAppId.
/// </summary>
page 50113 "WS API Res. Journal Lines"
{
    PageType = API;
    APIPublisher = 'schroeder';
    APIGroup = 'werkstatt';
    APIVersion = 'v1.0';
    EntityName = 'resourceJournalLine';
    EntitySetName = 'resourceJournalLines';
    EntityCaption = 'Resource Journal Line';
    EntitySetCaption = 'Resource Journal Lines';
    SourceTable = "Res. Journal Line";
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
                field(documentNumber; Rec."Document No.") { }
                field(resourceNumber; Rec."Resource No.") { }
                field(workTypeCode; Rec."Work Type Code") { }
                field(unitOfMeasureCode; Rec."Unit of Measure Code") { }
                field(quantity; Rec.Quantity) { }
                field(description; Rec.Description) { }
                field(lastModifiedDateTime; Rec.SystemModifiedAt) { Editable = false; }
            }
        }
    }

    var
        ApiHelper: Codeunit "WS Api Helper";

    trigger OnInsertRecord(BelowxRec: Boolean): Boolean
    var
        Existing: Record "Res. Journal Line";
    begin
        ApiHelper.RequireMonteurAppId(Rec."Monteur App Id");

        Existing.SetRange("Monteur App Id", Rec."Monteur App Id");
        if Existing.FindFirst() then begin
            Rec := Existing;
            exit(false);
        end;

        Rec."Line No." := ApiHelper.NextResJournalLineNo(Rec."Journal Template Name", Rec."Journal Batch Name");
        Rec.Insert(true);
        exit(false);
    end;
}
