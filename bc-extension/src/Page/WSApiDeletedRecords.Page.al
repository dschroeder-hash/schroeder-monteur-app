/// <summary>
/// Deletion log for delta sync (see codeunit "WS Deleted Record Log").
/// Filter with $filter=deletedAt gt {cursor}.
/// </summary>
page 50116 "WS API Deleted Records"
{
    PageType = API;
    APIPublisher = 'schroeder';
    APIGroup = 'werkstatt';
    APIVersion = 'v1.0';
    EntityName = 'deletedRecord';
    EntitySetName = 'deletedRecords';
    EntityCaption = 'Deleted Record';
    EntitySetCaption = 'Deleted Records';
    SourceTable = "WS Deleted Record";
    SourceTableView = sorting("Deleted At");
    ODataKeyFields = SystemId;
    Editable = false;
    InsertAllowed = false;
    ModifyAllowed = false;
    DeleteAllowed = false;
    Extensible = false;

    layout
    {
        area(Content)
        {
            repeater(Records)
            {
                field(id; Rec.SystemId) { }
                field(tableNumber; Rec."Table No.") { }
                field(recordSystemId; Rec."Record SystemId") { }
                field(deletedAt; Rec."Deleted At") { }
            }
        }
    }
}
