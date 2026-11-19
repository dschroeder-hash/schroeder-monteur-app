/// <summary>
/// Service comment lines of service orders. Used to transfer the work report
/// (split into lines of max. 80 characters by the Monteur-App). Idempotent via monteurAppId
/// (one id per line).
/// </summary>
page 50111 "WS API Service Comment Lines"
{
    PageType = API;
    APIPublisher = 'schroeder';
    APIGroup = 'werkstatt';
    APIVersion = 'v1.0';
    EntityName = 'serviceCommentLine';
    EntitySetName = 'serviceCommentLines';
    EntityCaption = 'Service Comment Line';
    EntitySetCaption = 'Service Comment Lines';
    SourceTable = "Service Comment Line";
    // Table Subtype "1" = Order for Table Name "Service Header".
    SourceTableView = where("Table Name" = const("Service Header"), "Table Subtype" = const("1"));
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
                field(type; Rec.Type) { }
                field(documentNumber; Rec."No.") { }
                field(serviceItemLineNumber; Rec."Table Line No.") { }
                field(lineNumber; Rec."Line No.") { Editable = false; }
                field("date"; Rec.Date) { }
                field(comment; Rec.Comment) { }
                field(lastModifiedDateTime; Rec.SystemModifiedAt) { Editable = false; }
            }
        }
    }

    var
        ApiHelper: Codeunit "WS Api Helper";

    trigger OnNewRecord(BelowxRec: Boolean)
    begin
        Rec."Table Name" := Rec."Table Name"::"Service Header";
        Rec."Table Subtype" := Rec."Table Subtype"::"1";
    end;

    trigger OnInsertRecord(BelowxRec: Boolean): Boolean
    var
        Existing: Record "Service Comment Line";
    begin
        ApiHelper.RequireMonteurAppId(Rec."Monteur App Id");

        Existing.SetRange("Monteur App Id", Rec."Monteur App Id");
        if Existing.FindFirst() then begin
            Rec := Existing;
            exit(false);
        end;

        Rec."Table Name" := Rec."Table Name"::"Service Header";
        Rec."Table Subtype" := Rec."Table Subtype"::"1";
        if Rec.Date = 0D then
            Rec.Date := WorkDate();
        Rec."Line No." := ApiHelper.NextServiceCommentLineNo(Rec);
        Rec.Insert(true);
        exit(false);
    end;
}
